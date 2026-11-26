import {
  AgentStatus,
  OrganizeSessionRequest,
  ProviderId,
  SessionCapabilities,
  type AgentEventDto,
  type AgentSessionDto,
  type OverviewResponse,
  type WorkerListResponse,
} from '@pocket-agent/protocol';
import { buildWorkers, WORKER_TOOL_NAMES } from '@pocket-agent/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit, type AppContext } from '../context.js';
import type { AgentEvent, AgentSession, Device, Prisma } from '../generated/prisma/client.js';

const IdParam = z.object({ id: z.uuid() });
/** Finished workers stay listed for a day. */
const WORKER_WINDOW_MS = 24 * 60 * 60 * 1000;
const PageQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ListQuery = z.object({ scope: z.enum(['active', 'all']).default('active') });
/** What makes a session a conversation: something said, or a step taken. */
const CONVERSATION_EVENTS = ['agent.output', 'agent.tool.started', 'agent.permission.requested'];

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
    // Recorded by the PC; anything unknown shows as Claude Code (the only one before Codex).
    provider: ProviderId.catch('claude-code').parse(s.provider),
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
    pinned: !!s.pinnedAt,
    archived: !!s.archivedAt,
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

  app.get('/sessions', { preHandler: user }, async (req, reply) => {
    const q = ListQuery.safeParse(req.query ?? {});
    if (!q.success) {
      return reply.code(400).send({ error: 'invalid_request', message: q.error.issues[0]?.message });
    }
    const { scope } = q.data;
    const sessions = await ctx.prisma.agentSession.findMany({
      where: { ...owned(req.user!.id), ...(scope === 'active' ? { endedAt: null } : {}) },
      include: { device: { select: { name: true } } },
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
    });
    // Claude Code sometimes starts a session nobody uses (e.g. the editor's panel opened in a window
    // with no folder) that exits again: ended, nothing ever said, nothing to show or continue. Those
    // aren't chats. One still running stays (it can be messaged).
    const blank = sessions.filter((s) => s.endedAt && !s.currentTask).map((s) => s.id);
    const said = blank.length
      ? new Set(
          (
            await ctx.prisma.agentEvent.findMany({
              where: { sessionId: { in: blank }, eventType: { in: CONVERSATION_EVENTS } },
              select: { sessionId: true },
              distinct: ['sessionId'],
            })
          ).map((e) => e.sessionId),
        )
      : new Set<string | null>();
    const empty = new Set(blank.filter((id) => !said.has(id)));
    return { sessions: sessions.filter((s) => !empty.has(s.id)).map(toSessionDto) };
  });

  // Pin a chat to the top of the list, or archive it out of the list (archiving unpins it).
  app.post(
    '/sessions/:id/organize',
    { preHandler: [requireTrustedOrigin(ctx), user], config: limit(ctx, 60) },
    async (req, reply) => {
      const p = IdParam.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });
      const body = OrganizeSessionRequest.safeParse(req.body ?? {});
      if (!body.success)
        return reply.code(400).send({ error: 'invalid_request', message: 'Pin or archive?' });
      const s = await ctx.prisma.agentSession.findFirst({ where: { id: p.data.id, ...owned(req.user!.id) } });
      if (!s) return reply.code(404).send({ error: 'not_found' });
      const now = ctx.now();
      const { pinned, archived } = body.data;
      const updated = await ctx.prisma.agentSession.update({
        where: { id: s.id },
        data: {
          ...(pinned !== undefined ? { pinnedAt: pinned ? now : null } : {}),
          ...(archived !== undefined ? { archivedAt: archived ? now : null } : {}),
          ...(archived ? { pinnedAt: null } : {}),
        },
        include: { device: { select: { name: true } } },
      });
      return { session: toSessionDto(updated) };
    },
  );

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
    if (!q.success) {
      return reply.code(400).send({ error: 'invalid_request', message: q.error.issues[0]?.message });
    }
    return eventPage(ctx, { sessionId: s.id }, req.query, false);
  });

  /**
   * Background workers Claude started in your chats: sub-agents and workflows, the ones still
   * running and the ones that finished in the last day. Worked out from the sessions' events, the
   * same way the apps read them (`buildWorkers` in @pocket-agent/core).
   */
  app.get('/workers', { preHandler: user }, async (req): Promise<WorkerListResponse> => {
    const now = ctx.now().getTime();
    const day = new Date(now - WORKER_WINDOW_MS);
    const sessions = await ctx.prisma.agentSession.findMany({
      where: { ...owned(req.user!.id), OR: [{ endedAt: null }, { lastActivityAt: { gte: day } }] },
      orderBy: { lastActivityAt: 'desc' },
      take: 50,
      include: { device: { select: { name: true } } },
    });
    if (!sessions.length) return { workers: [] };
    const events = await ctx.prisma.agentEvent.findMany({
      where: {
        sessionId: { in: sessions.map((s) => s.id) },
        createdAt: { gte: new Date(now - 7 * WORKER_WINDOW_MS) },
        OR: [
          {
            eventType: { in: ['agent.tool.started', 'agent.tool.completed', 'agent.tool.failed'] },
            OR: WORKER_TOOL_NAMES.map((name) => ({ payload: { path: ['toolName'], equals: name } })),
          },
          // A background worker reports back through a task notification in the conversation.
          { eventType: 'agent.output', payload: { path: ['text'], string_contains: '<task-notification>' } },
          { eventType: 'agent.worker.updated' },
          { eventType: 'agent.session.ended' },
        ],
      },
      // Newest first so the cap drops the oldest, then back to oldest first for buildWorkers.
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    events.reverse();
    const bySession = new Map<string, AgentEvent[]>();
    for (const e of events) {
      if (!e.sessionId) continue;
      bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
    }
    const workers: WorkerListResponse['workers'] = [];
    for (const s of sessions) {
      const list = bySession.get(s.id);
      if (!list) continue;
      for (const w of buildWorkers(list.map((e) => toEventDto(e)))) {
        if (w.status !== 'running' && Date.parse(w.finishedAt ?? w.startedAt) < day.getTime()) continue;
        workers.push({ ...w, sessionId: s.id, projectName: s.projectName, deviceName: s.device.name });
      }
    }
    workers.sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
    return { workers: workers.slice(0, 100) };
  });

  app.get('/activity', { preHandler: user }, async (req, reply) => {
    const q = PageQuery.safeParse(req.query ?? {});
    if (!q.success) {
      return reply.code(400).send({ error: 'invalid_request', message: q.error.issues[0]?.message });
    }
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
