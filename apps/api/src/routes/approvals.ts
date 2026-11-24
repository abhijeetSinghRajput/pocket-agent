import {
  BackendToAgent,
  createEvent,
  DecideApprovalRequest,
  SetAwayModeRequest,
} from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { approvalInclude, decideApproval, DecisionError, toApprovalDto } from '../approvals/service.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import type { Services } from '../commands/service.js';
import { limit } from '../context.js';
import { audit } from '../lib/audit.js';
import { CHANNELS, notifyUser } from '../realtime/bus.js';
import { toDeviceDto } from './devices.js';

const IdParam = z.object({ id: z.uuid() });
const ListQuery = z.object({ status: z.enum(['pending', 'all']).default('pending') });

export async function approvalRoutes(app: FastifyInstance, ctx: Services): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);

  app.get('/approvals', { preHandler: user }, async (req, reply) => {
    const q = ListQuery.safeParse(req.query ?? {});
    if (!q.success) {
      return reply.code(400).send({ error: 'invalid_request', message: q.error.issues[0]?.message });
    }
    const { status } = q.data;
    const approvals = await ctx.prisma.approval.findMany({
      where: {
        userId: req.user!.id,
        ...(status === 'pending' ? { status: 'Pending', decision: null, expiresAt: { gt: ctx.now() } } : {}),
      },
      include: approvalInclude,
      orderBy: { createdAt: 'desc' },
      take: status === 'pending' ? 100 : 50,
    });
    return { approvals: approvals.map(toApprovalDto) };
  });

  app.get('/approvals/:id', { preHandler: user }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const a = await ctx.prisma.approval.findFirst({
      where: { id: p.data.id, userId: req.user!.id },
      include: approvalInclude,
    });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return { approval: toApprovalDto(a) };
  });

  app.post(
    '/approvals/:id/decision',
    { preHandler: [trusted, user], config: limit(ctx, 60) },
    async (req, reply) => {
      const p = IdParam.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });
      const body = DecideApprovalRequest.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const a = await decideApproval(ctx, {
          userId: req.user!.id,
          approvalId: p.data.id,
          decision: body.data.decision,
          ...(body.data.message ? { message: body.data.message } : {}),
          ...(body.data.answers ? { answers: body.data.answers } : {}),
          ip: req.ip,
        });
        return { approval: toApprovalDto(a) };
      } catch (err) {
        if (err instanceof DecisionError)
          return reply.code(err.status).send({ error: err.code, message: err.message });
        throw err;
      }
    },
  );

  /** Away mode: route permission requests of sessions the user started to the dashboard. */
  app.post(
    '/devices/:id/away',
    { preHandler: [trusted, user], config: limit(ctx, 30) },
    async (req, reply) => {
      const p = IdParam.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });
      const body = SetAwayModeRequest.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      const device = await ctx.prisma.device.findFirst({ where: { id: p.data.id, userId: req.user!.id } });
      if (!device) return reply.code(404).send({ error: 'not_found' });
      if (device.revokedAt) return reply.code(409).send({ error: 'device_revoked' });
      const updated = await ctx.prisma.device.update({
        where: { id: device.id },
        data: { awayMode: body.data.awayMode },
      });
      await audit(ctx.prisma, {
        userId: req.user!.id,
        actorType: 'user',
        actorId: req.user!.id,
        action: 'device.away_mode',
        targetType: 'device',
        targetId: device.id,
        metadata: { awayMode: body.data.awayMode },
        ip: req.ip,
      });
      const frame = BackendToAgent.parse(
        createEvent('config.update', { awayMode: body.data.awayMode }, { deviceId: device.id }),
      );
      await ctx.bus.publish(CHANNELS.agentCommands, JSON.stringify({ deviceId: device.id, frame }));
      await notifyUser(
        ctx.bus,
        req.user!.id,
        createEvent(
          'device.status.changed',
          { status: updated.status, lastHeartbeatAt: updated.lastHeartbeatAt?.toISOString() ?? null },
          { deviceId: device.id },
        ),
      );
      return { device: toDeviceDto(updated) };
    },
  );
}
