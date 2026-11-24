import {
  BackendToAgent,
  createEvent,
  FOLDERS_MIN_AGENT_VERSION,
  isWithinFolder,
  PAIRING_CODE_TTL_MS,
  ClaudeUsage,
  ModelOption,
  PairDeviceRequest,
  type DeviceDto,
  type PairingCodeResponse,
} from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateDevice } from '../auth/device-auth.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit, redisKey, type AppContext } from '../context.js';
import { CHANNELS, notifyUser, type Bus } from '../realtime/bus.js';
import { versionBelow } from '@pocket-agent/protocol';
import { FOLDER_LIST_WAIT_MS, folderReplyKey } from '../devices/folders.js';
import { publishRevocation } from '../gateway/agent-gateway.js';
import type { Device } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { generatePairingCode, normalizePairingCode, randomToken, sha256 } from '../lib/crypto.js';

const MAX_ACTIVE_PAIRING_CODES = 5;
const DeviceIdParam = z.object({ id: z.uuid() });
const FolderQuery = z.object({ path: z.string().trim().min(1).max(1024) });
const FOLDER_POLL_MS = 120;

const FOLDER_ERRORS: Record<string, string> = {
  project_not_allowed: 'That folder is not on this PC’s project list.',
  folder_not_found: 'That folder is no longer on your PC.',
  folder_unreadable: 'Your PC could not open that folder.',
};

export function toDeviceDto(d: Device): DeviceDto {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    agentVersion: d.agentVersion,
    status: d.revokedAt ? 'Revoked' : d.status,
    lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    revokedAt: d.revokedAt?.toISOString() ?? null,
    remoteApprovalEnabled: d.remoteApprovalEnabled,
    projects: Array.isArray(d.projects)
      ? (d.projects as Array<{ name?: unknown; path?: unknown }>)
          .filter((p) => typeof p.name === 'string' && typeof p.path === 'string')
          .map((p) => ({ name: p.name as string, path: p.path as string }))
      : [],
    observedInstructions: d.observedInstructions,
    models: z.array(ModelOption).catch([]).parse(d.models),
    usage: ClaudeUsage.nullable()
      .catch(null)
      .parse(d.usage ?? null),
    awayMode: d.awayMode,
  };
}

/** Browser-facing device management (session cookie). */
export async function deviceRoutes(app: FastifyInstance, ctx: AppContext & { bus: Bus }): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);

  app.post(
    '/devices/pairing-codes',
    { preHandler: [trusted, user], config: limit(ctx, 10) },
    async (req, reply) => {
      const userId = req.user!.id;
      const now = ctx.now();
      const active = await ctx.prisma.pairingCode.count({
        where: { userId, consumedAt: null, expiresAt: { gt: now } },
      });
      if (active >= MAX_ACTIVE_PAIRING_CODES) {
        return reply.code(429).send({
          error: 'too_many_pairing_codes',
          message: 'Too many unused pairing codes. Wait for one to expire or use it.',
        });
      }
      const code = generatePairingCode();
      const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
      const row = await ctx.prisma.pairingCode.create({
        data: { userId, codeHash: sha256(normalizePairingCode(code)!), expiresAt },
      });
      await audit(ctx.prisma, {
        userId,
        actorType: 'user',
        actorId: userId,
        action: 'device.pairing_code_created',
        targetType: 'pairing_code',
        targetId: row.id,
        ip: req.ip,
      });
      const body: PairingCodeResponse = { code, expiresAt: expiresAt.toISOString() };
      return reply.code(201).send(body);
    },
  );

  app.get('/devices', { preHandler: user }, async (req) => {
    const devices = await ctx.prisma.device.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return { devices: devices.map(toDeviceDto) };
  });

  app.post('/devices/:id/revoke', { preHandler: [trusted, user] }, async (req, reply) => {
    const params = DeviceIdParam.safeParse(req.params);
    // Unknown, malformed and other users' devices all look the same: 404.
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const userId = req.user!.id;
    const device = await ctx.prisma.device.findFirst({ where: { id: params.data.id, userId } });
    if (!device) return reply.code(404).send({ error: 'not_found' });
    if (device.revokedAt) return { device: toDeviceDto(device) };

    const revoked = await ctx.prisma.device.update({
      where: { id: device.id },
      data: { revokedAt: ctx.now(), status: 'Revoked', pendingSecretHash: null },
    });
    await audit(ctx.prisma, {
      userId,
      actorType: 'user',
      actorId: userId,
      action: 'device.revoked',
      targetType: 'device',
      targetId: device.id,
      ip: req.ip,
    });
    // A revoked device can't report on its sessions any more: end them.
    await ctx.prisma.agentSession.updateMany({
      where: { deviceId: device.id, endedAt: null },
      data: { status: 'Stopped', endedAt: ctx.now() },
    });
    await publishRevocation(ctx, device.id);
    await notifyUser(
      ctx.bus,
      userId,
      createEvent(
        'device.status.changed',
        { status: 'Revoked', lastHeartbeatAt: null },
        { deviceId: device.id },
      ),
    );
    return { device: toDeviceDto(revoked) };
  });

  /**
   * The folders directly inside `path` (an allowed project, or a folder inside one) on this PC,
   * asked of the PC live. Only folder names travel; the PC checks the path against its own list.
   */
  app.get('/devices/:id/folders', { preHandler: user, config: limit(ctx, 60) }, async (req, reply) => {
    const params = DeviceIdParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const query = FolderQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_request', message: 'Which folder?' });
    const device = await ctx.prisma.device.findFirst({
      where: { id: params.data.id, userId: req.user!.id },
    });
    if (!device) return reply.code(404).send({ error: 'not_found' });
    const fail = (code: number, error: string, message: string) => reply.code(code).send({ error, message });
    if (device.revokedAt) return fail(409, 'device_revoked', 'This device was revoked.');
    const dto = toDeviceDto(device);
    if (!dto.projects.some((p) => isWithinFolder(query.data.path, p.path)))
      return fail(400, 'project_not_allowed', FOLDER_ERRORS.project_not_allowed!);
    if (versionBelow(device.agentVersion, FOLDERS_MIN_AGENT_VERSION))
      return fail(
        409,
        'agent_outdated',
        `Browsing folders needs Pocket Agent ${FOLDERS_MIN_AGENT_VERSION} or newer on the PC. Run \`pocket-agent update\` there.`,
      );
    const online =
      device.status === 'Online' &&
      (await ctx.redis.exists(redisKey(ctx, 'presence', device.id)).catch(() => 0)) === 1;
    if (!online) return fail(409, 'device_offline', 'Your PC is offline. Start Pocket Agent on it.');

    const requestId = crypto.randomUUID();
    const frame = BackendToAgent.parse(
      createEvent('folder.list', { requestId, path: query.data.path }, { deviceId: device.id }),
    );
    await ctx.bus.publish(CHANNELS.agentCommands, JSON.stringify({ deviceId: device.id, frame }));

    const key = folderReplyKey(ctx, requestId);
    const deadline = Date.now() + FOLDER_LIST_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, FOLDER_POLL_MS));
      const raw = await ctx.redis.get(key);
      if (!raw) continue;
      await ctx.redis.del(key).catch(() => undefined);
      const answer = JSON.parse(raw) as {
        folders: Array<{ name: string; path: string }>;
        truncated: boolean;
        error?: string;
      };
      if (answer.error)
        return fail(
          answer.error === 'project_not_allowed' ? 400 : 404,
          answer.error,
          FOLDER_ERRORS[answer.error] ?? 'Your PC could not list that folder.',
        );
      return { path: query.data.path, folders: answer.folders, truncated: answer.truncated };
    }
    return fail(504, 'pc_no_answer', 'Your PC did not answer. Check that Pocket Agent is running on it.');
  });
}

/** Endpoints called by the Local Agent (no browser cookies; device credentials or a pairing code). */
export async function agentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/devices/pair', { config: limit(ctx, 10) }, async (req, reply) => {
    const parsed = PairDeviceRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const { code, name, platform, agentVersion } = parsed.data;
    const normalized = normalizePairingCode(code);
    const invalid = {
      error: 'invalid_or_expired_code',
      message: 'This pairing code is invalid or has expired.',
    };
    if (!normalized) return reply.code(400).send(invalid);

    const secret = randomToken();
    const result = await ctx.prisma.$transaction(async (tx) => {
      const now = ctx.now();
      const codeHash = sha256(normalized);
      // Atomic single-use consumption: only one concurrent request can win.
      const consumed = await tx.pairingCode.updateMany({
        where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      const { userId } = await tx.pairingCode.findUniqueOrThrow({ where: { codeHash } });
      const device = await tx.device.create({
        data: { userId, name, platform, agentVersion, secretHash: sha256(secret) },
      });
      await audit(tx, {
        userId,
        actorType: 'device',
        actorId: device.id,
        action: 'device.paired',
        targetType: 'device',
        targetId: device.id,
        metadata: { name, platform, agentVersion },
        ip: req.ip,
      });
      return device;
    });
    if (!result) return reply.code(400).send(invalid);
    return reply.code(201).send({ deviceId: result.id, deviceSecret: secret });
  });

  app.post('/agent/credentials/rotate', { config: limit(ctx, 5) }, async (req, reply) => {
    const auth = await authenticateDevice(ctx, req.headers.authorization);
    if (!auth.ok)
      return reply.code(401).send({ error: auth.reason === 'revoked' ? 'device_revoked' : 'unauthorized' });
    const secret = randomToken();
    await ctx.prisma.device.update({
      where: { id: auth.device.id },
      data: { pendingSecretHash: sha256(secret) },
    });
    await audit(ctx.prisma, {
      userId: auth.device.userId,
      actorType: 'device',
      actorId: auth.device.id,
      action: 'device.secret_rotation_requested',
      targetType: 'device',
      targetId: auth.device.id,
      ip: req.ip,
    });
    return { deviceSecret: secret };
  });

  /** Authenticating with the pending secret completes a rotation; this endpoint does only that. */
  app.post('/agent/credentials/confirm', { config: limit(ctx, 10) }, async (req, reply) => {
    const auth = await authenticateDevice(ctx, req.headers.authorization);
    if (!auth.ok)
      return reply.code(401).send({ error: auth.reason === 'revoked' ? 'device_revoked' : 'unauthorized' });
    return reply.code(204).send();
  });
}
