import {
  CreatePairingRequest,
  PAIRING_REQUEST_TTL_MS,
  PollPairingRequest,
  type PairDeviceResponse,
  type PairingRequestCreated,
  type PairingRequestDto,
} from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit, type AppContext } from '../context.js';
import type { PairingRequest } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { generatePairingCode, randomToken, sha256 } from '../lib/crypto.js';

/**
 * Pairing with a QR code (no typing): the PC asks for a request and shows its link as a QR code,
 * with a short check code. You open the link (scanning it in the app, or with the phone's camera
 * in the browser), see which PC is asking and the same check code, and approve. The PC, asking
 * every few seconds with a token only it has, then collects its credentials, once.
 *
 * Approving never hands out credentials by itself: they go only to whoever holds the poll token,
 * and only once. A request can be approved for 10 minutes.
 */

const RequestIdParam = z.object({ id: z.uuid() });

function statusOf(r: PairingRequest, now: Date): PairingRequestDto['status'] {
  if (r.consumedAt) return 'paired';
  if (r.declinedAt) return 'declined';
  if (r.approvedAt) return 'approved';
  return r.expiresAt <= now ? 'expired' : 'pending';
}

function toDto(r: PairingRequest, now: Date): PairingRequestDto {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    agentVersion: r.agentVersion,
    check: r.check,
    expiresAt: r.expiresAt.toISOString(),
    status: statusOf(r, now),
  };
}

/** The PC's side: no credentials yet, so only the poll token proves who is asking. */
export async function pairingAgentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/devices/pair/requests', { config: limit(ctx, 10) }, async (req, reply) => {
    const parsed = CreatePairingRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const pollToken = randomToken();
    const expiresAt = new Date(ctx.now().getTime() + PAIRING_REQUEST_TTL_MS);
    const row = await ctx.prisma.pairingRequest.create({
      data: {
        ...parsed.data,
        pollTokenHash: sha256(pollToken),
        check: generatePairingCode().slice(0, 4),
        expiresAt,
      },
    });
    const body: PairingRequestCreated = {
      requestId: row.id,
      pollToken,
      check: row.check,
      link: new URL(`/pair/${row.id}`, ctx.env.WEB_ORIGINS[0]).toString(),
      expiresAt: expiresAt.toISOString(),
    };
    return reply.code(201).send(body);
  });

  // Asked every few seconds while the QR code is shown: 202 while waiting, 201 with credentials.
  app.post('/devices/pair/requests/:id/poll', { config: limit(ctx, 60) }, async (req, reply) => {
    const params = RequestIdParam.safeParse(req.params);
    const body = PollPairingRequest.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(404).send({ error: 'not_found' });
    const now = ctx.now();
    const row = await ctx.prisma.pairingRequest.findFirst({
      where: { id: params.data.id, pollTokenHash: sha256(body.data.pollToken) },
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const status = statusOf(row, now);
    if (status === 'declined')
      return reply
        .code(403)
        .send({ error: 'pairing_declined', message: 'Pairing was declined on the phone.' });
    if (status === 'paired')
      return reply.code(410).send({ error: 'pairing_used', message: 'This pairing was already used.' });
    if (status === 'expired')
      return reply
        .code(410)
        .send({ error: 'pairing_expired', message: 'The QR code expired. Run this again.' });
    if (status === 'pending') return reply.code(202).send({ status: 'pending' });

    // Approved: create the device and hand out its secret, exactly once.
    const secret = randomToken();
    const device = await ctx.prisma.$transaction(async (tx) => {
      const won = await tx.pairingRequest.updateMany({
        where: { id: row.id, consumedAt: null, approvedAt: { not: null }, declinedAt: null },
        data: { consumedAt: now },
      });
      if (won.count !== 1) return null;
      const d = await tx.device.create({
        data: {
          userId: row.userId!,
          name: row.name,
          platform: row.platform,
          agentVersion: row.agentVersion,
          secretHash: sha256(secret),
        },
      });
      await tx.pairingRequest.update({ where: { id: row.id }, data: { deviceId: d.id } });
      await audit(tx, {
        userId: row.userId!,
        actorType: 'device',
        actorId: d.id,
        action: 'device.paired',
        targetType: 'device',
        targetId: d.id,
        metadata: { name: row.name, platform: row.platform, agentVersion: row.agentVersion, via: 'qr' },
        ip: req.ip,
      });
      return d;
    });
    if (!device)
      return reply.code(410).send({ error: 'pairing_used', message: 'This pairing was already used.' });
    const res: PairDeviceResponse = { deviceId: device.id, deviceSecret: secret };
    return reply.code(201).send(res);
  });
}

/** Your side (signed in): see which PC is asking, then approve or decline it. */
export async function pairingUserRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);

  async function find(id: unknown) {
    const params = RequestIdParam.safeParse({ id });
    if (!params.success) return null;
    return ctx.prisma.pairingRequest.findUnique({ where: { id: params.data.id } });
  }
  // Someone else's approved request looks like any unknown one.
  const visible = (r: PairingRequest | null, userId: string) => !!r && (!r.userId || r.userId === userId);

  app.get('/pairing/requests/:id', { preHandler: user, config: limit(ctx, 30) }, async (req, reply) => {
    const r = await find((req.params as { id?: unknown }).id);
    if (!visible(r, req.user!.id)) return reply.code(404).send({ error: 'not_found' });
    return { request: toDto(r!, ctx.now()) };
  });

  for (const action of ['approve', 'decline'] as const) {
    app.post(
      `/pairing/requests/:id/${action}`,
      { preHandler: [trusted, user], config: limit(ctx, 10) },
      async (req, reply) => {
        const userId = req.user!.id;
        const r = await find((req.params as { id?: unknown }).id);
        if (!visible(r, userId)) return reply.code(404).send({ error: 'not_found' });
        const now = ctx.now();
        const done = await ctx.prisma.pairingRequest.updateMany({
          where: { id: r!.id, approvedAt: null, declinedAt: null, expiresAt: { gt: now } },
          data: action === 'approve' ? { approvedAt: now, userId } : { declinedAt: now },
        });
        if (done.count !== 1) {
          const status = statusOf(r!, now);
          return reply.code(409).send({
            error: `pairing_${status}`,
            message:
              status === 'expired'
                ? 'This QR code expired. Run `pocket-agent connect` on the PC again.'
                : 'This pairing was already answered.',
          });
        }
        const updated = await ctx.prisma.pairingRequest.findUniqueOrThrow({ where: { id: r!.id } });
        return { request: toDto(updated, now) };
      },
    );
  }
}
