import {
  AgentStatus,
  SessionCapabilities,
  type AgentEventDto,
  type AgentSessionDto,
  type OverviewResponse,
} from '@agentdock/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.js';
import type { AppContext } from '../context.js';
import type { AgentEvent, AgentSession, Device, Prisma } from '../generated/prisma/client.js';

const IdParam = z.object({ id: z.uuid() });
const PageQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ListQuery = z.object({ scope: z.enum(['active', 'all']).default('active') });

const NO_CAPABILITIES: SessionCapabilities = {
  monitor: false,
  remoteApproval: false,
  instructAnytime: false,
  instructBetweenTurns: false,
  interrupt: false,
};

export function toSessionDto(s: AgentSession & { device: Pick<Device, 'name'> }): AgentSessionDto {
  const caps = SessionCapabilities.safeParse(s.capabilities);
  const meta = z.record(z.string(), z.string()).safeParse(s.metadata);
  return {
    id: s.id,
    deviceId: s.deviceId,
    deviceName: s.device.name,
    provider: 'claude-code',
    mode: s.mode,
    externalSessionId: s.externalSessionId,
    projectName: s.projectName,
    projectPath: s.projectPath,
    status: AgentStatus.parse(s.status),
    // Never claim a capability that isn't recorded.
    capabilities: caps.success ? caps.data : NO_CAPABILITIES,
    metadata: meta.success ? meta.data : null,
    currentTask: s.currentTask,
    startedAt: s.startedAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

type EventRow = AgentEvent & {
  session?: (Pick<AgentSession, 'id' | 'projectName'> & { device: Pick<Device, 'name'> }) | null;
};

export function toEventDto(e: EventRow): AgentEventDto {
  return {
    id: e.id,
    sessionId: e.sessionId,
    eventType: e.eventType,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt.toISOString(),
    ...(e.session
      ? {
          session: {
            id: e.session.id,
            projectName: e.session.projectName,
            deviceName: e.session.device.name,
          },
        }
      : {}),
  };
}

/** Newest first; cursor = id of the last event on the previous page. */
async function eventPage(
  ctx: AppContext,
  where: Prisma.AgentEventWhereInput,
  query: unknown,
  withSession: boolean,
) {
  const { before, limit } = PageQuery.parse(query ?? {});
  const rows = await ctx.prisma.agentEvent.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    ...(withSession
      ? {
          include: {
            session: { select: { id: true, projectName: true, device: { select: { name: true } } } },
          },
        }
      : {}),
  });
  return {
    events: rows.map((r) => toEventDto(r as EventRow)),
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
  };
}

export async function sessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const user = requireUser(ctx);
  const owned = (userId: string) => ({ device: { userId } });

  app.get('/sessions', { preHandler: user }, async (req) => {
    const { scope } = ListQuery.parse(req.query ?? {});
    const sessions = await ctx.prisma.agentSession.findMany({
      where: { ...owned(req.user!.id), ...(scope === 'active' ? { endedAt: null } : {}) },
      include: { device: { select: { name: true } } },
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
    });
    return { sessions: sessions.map(toSessionDto) };
  });

  app.get('/sessions/:id', { preHandler: user }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const s = await ctx.prisma.agentSession.findFirst({
      where: { id: p.data.id, ...owned(req.user!.id) },
      include: { device: { select: { name: true } } },
    });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    return { session: toSessionDto(s) };
  });

  app.get('/sessions/:id/events', { preHandler: user }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const s = await ctx.prisma.agentSession.findFirst({
      where: { id: p.data.id, ...owned(req.user!.id) },
      select: { id: true },
    });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const q = PageQuery.safeParse(req.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    return eventPage(ctx, { sessionId: s.id }, req.query, false);
  });

  app.get('/activity', { preHandler: user }, async (req, reply) => {
    const q = PageQuery.safeParse(req.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    return eventPage(ctx, { session: owned(req.user!.id) }, req.query, true);
  });

  app.get('/overview', { preHandler: user }, async (req): Promise<OverviewResponse> => {
    const userId = req.user!.id;
    const [devices, statuses, recent] = await Promise.all([
      ctx.prisma.device.groupBy({ by: ['status'], where: { userId, revokedAt: null }, _count: true }),
      ctx.prisma.agentSession.groupBy({
        by: ['status'],
        where: { ...owned(userId), endedAt: null },
        _count: true,
      }),
      eventPage(ctx, { session: owned(userId) }, { limit: 8 }, true),
    ]);
    const count = (s: string) => statuses.find((x) => x.status === s)?._count ?? 0;
    return {
      devices: {
        online: devices.find((d) => d.status === 'Online')?._count ?? 0,
        total: devices.reduce((n, d) => n + d._count, 0),
      },
      sessions: {
        active: statuses.reduce((n, s) => n + s._count, 0),
        running: count('Running') + count('Starting'),
        waitingForInput: count('WaitingForInput'),
        waitingForPermission: count('WaitingForPermission'),
        disconnected: count('Disconnected'),
      },
      recent: recent.events,
    };
  });
}
