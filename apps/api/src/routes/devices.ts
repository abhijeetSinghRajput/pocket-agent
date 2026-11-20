import {
  createEvent,
  PAIRING_CODE_TTL_MS,
  PairDeviceRequest,
  type DeviceDto,
  type PairingCodeResponse,
} from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateDevice } from '../auth/device-auth.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit, type AppContext } from '../context.js';
import { notifyUser, type Bus } from '../realtime/bus.js';
import { publishRevocation } from '../gateway/agent-gateway.js';
import type { Device } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { generatePairingCode, normalizePairingCode, randomToken, sha256 } from '../lib/crypto.js';

const MAX_ACTIVE_PAIRING_CODES = 5;
const DeviceIdParam = z.object({ id: z.uuid() });

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
