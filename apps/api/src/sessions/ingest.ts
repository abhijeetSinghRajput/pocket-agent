import {
  APPROVAL_WAIT_MS,
  createEvent,
  SESSION_SCOPED_EVENTS,
  type AgentStatus,
  type AgentToBackend,
  type BackendToWeb,
} from '@pocket-agent/protocol';
import { closeApprovalFromPc, openApproval } from '../approvals/service.js';
import type { AppContext } from '../context.js';
import type { AgentSession, Prisma } from '../generated/prisma/client.js';

export class InvalidAgentEvent extends Error {}

type SessionEvent = Exclude<
  AgentToBackend,
  {
    eventType:
      'device.connected' | 'device.heartbeat' | 'device.settings' | 'command.ack' | 'approval.decision.ack';
  }
>;

export function isSessionEvent(msg: AgentToBackend): msg is SessionEvent {
  return SESSION_SCOPED_EVENTS.has(msg.eventType) || msg.eventType === 'agent.sessions.snapshot';
}

/** Status implied by an event, or null if it doesn't change status. */
function impliedStatus(msg: SessionEvent): AgentStatus | null {
  switch (msg.eventType) {
    case 'agent.session.started':
    case 'agent.session.updated':
      return msg.payload.status;
    case 'agent.tool.started':
    case 'agent.tool.completed':
    case 'agent.tool.failed':
    case 'agent.permission.resolved':
      return 'Running';
    case 'agent.permission.requested':
      return 'WaitingForPermission';
    case 'agent.session.ended':
      return 'Stopped';
    default:
      return null;
  }
}

const statusChanged = (
  session: AgentSession,
  status: AgentStatus,
  previous: AgentStatus | null,
): BackendToWeb =>
  createEvent(
    'agent.status.changed',
    { status, previous },
    { sessionId: session.id, deviceId: session.deviceId },
  );

/**
 * Applies one session event from a device. Idempotent: an eventId seen before is a no-op, so the
 * agent can safely replay unacknowledged events after a reconnect. Returns browser notifications.
 */
export async function ingestSessionEvent(
  ctx: AppContext,
  device: { id: string; userId: string },
  msg: SessionEvent,
): Promise<BackendToWeb[]> {
  if (msg.eventType === 'agent.sessions.snapshot') return applySnapshot(ctx, device, msg);

  const externalSessionId = msg.sessionId;
  if (!externalSessionId) throw new InvalidAgentEvent(`${msg.eventType} requires sessionId`);
  if ('externalSessionId' in msg.payload && msg.payload.externalSessionId !== externalSessionId) {
    throw new InvalidAgentEvent('payload.externalSessionId does not match envelope sessionId');
  }

  return ctx.prisma.$transaction(async (tx) => {
    if (await tx.agentEvent.findUnique({ where: { eventId: msg.eventId }, select: { id: true } })) {
      return []; // replay of an event we already stored
    }
    const now = ctx.now();
    const key = { deviceId_externalSessionId: { deviceId: device.id, externalSessionId } };

    let session: AgentSession | null;
    let before: AgentStatus | null;
    if (msg.eventType === 'agent.session.started') {
      const p = msg.payload;
      const existing = await tx.agentSession.findUnique({ where: key });
      before = existing?.status ?? null;
      const fields = {
        provider: p.provider,
        mode: p.mode,
        projectName: p.projectName,
        projectPath: p.projectPath,
        status: p.status,
        capabilities: p.capabilities,
        metadata: p.metadata ?? undefined,
        lastActivityAt: now,
      };
      session = await tx.agentSession.upsert({
        where: key,
        create: { deviceId: device.id, externalSessionId, ...fields },
        // A resumed session (same id) is live again.
        update: { ...fields, endedAt: null },
      });
    } else {
      session = await tx.agentSession.findUnique({ where: key });
      if (!session) return []; // unknown session: the agent always announces sessions first; drop
      before = session.status;
      const next = impliedStatus(msg);
      // An ended session stays ended until it is announced again (resume).
      const status = session.status === 'Stopped' ? session.status : (next ?? session.status);
      const data: Prisma.AgentSessionUpdateInput = { lastActivityAt: now, status };
      if (msg.eventType === 'agent.session.updated' && msg.payload.currentTask !== undefined) {
        data.currentTask = msg.payload.currentTask;
      }
      if (msg.eventType === 'agent.session.ended') data.endedAt = now;
      session = await tx.agentSession.update({ where: { id: session.id }, data });
    }

    const row = await tx.agentEvent.create({
      data: {
        eventId: msg.eventId,
        deviceId: device.id,
        sessionId: session.id,
        eventType: msg.eventType,
        payload: msg.payload as Prisma.InputJsonValue,
        createdAt: new Date(msg.timestamp),
      },
    });

    const out: BackendToWeb[] = [
      createEvent(
        'agent.event.created',
        { agentEventId: row.id, eventType: msg.eventType },
        { sessionId: session.id, deviceId: device.id },
      ),
    ];
    if (before !== session.status) out.push(statusChanged(session, session.status, before));

    // Remote approval: the PC is holding this request for a decision from Pocket Agent.
    if (msg.eventType === 'agent.permission.requested' && msg.payload.awaitingRemote) {
      const opened = await openApproval(tx, {
        userId: device.userId,
        deviceId: device.id,
        sessionId: session.id,
        requestId: msg.payload.requestId,
        toolName: msg.payload.toolName,
        inputSummary: msg.payload.input,
        expiresAt: msg.payload.expiresAt
          ? new Date(msg.payload.expiresAt)
          : new Date(now.getTime() + APPROVAL_WAIT_MS.observed),
      });
      if (opened) {
        out.push(
          createEvent(
            'approval.created',
            { approvalId: opened.id },
            { deviceId: device.id, sessionId: session.id },
          ),
        );
      }
    }
    if (msg.eventType === 'agent.permission.resolved') {
      const closed = await closeApprovalFromPc(tx, session.id, msg.payload.requestId, msg.payload.outcome);
      if (closed) {
        out.push(
          createEvent(
            'approval.updated',
            { approvalId: closed.id, status: closed.status },
            { deviceId: device.id, sessionId: session.id },
          ),
        );
      }
    }
    return out;
  });
}

async function applySnapshot(
  ctx: AppContext,
  device: { id: string },
  msg: Extract<SessionEvent, { eventType: 'agent.sessions.snapshot' }>,
): Promise<BackendToWeb[]> {
  const live = new Map(msg.payload.sessions.map((s) => [s.externalSessionId, s.status]));
  return ctx.prisma.$transaction(async (tx) => {
    const open = await tx.agentSession.findMany({ where: { deviceId: device.id, endedAt: null } });
    const now = ctx.now();
    const out: BackendToWeb[] = [];
    for (const s of open) {
      const status = live.get(s.externalSessionId);
      if (status === undefined) {
        // The PC no longer knows this session: it ended while we weren't connected.
        const ended = await tx.agentSession.update({
          where: { id: s.id },
          data: { status: 'Stopped', endedAt: now },
        });
        out.push(statusChanged(ended, 'Stopped', s.status));
      } else if (status !== s.status) {
        const updated = await tx.agentSession.update({ where: { id: s.id }, data: { status } });
        out.push(statusChanged(updated, status, s.status));
      }
    }
    return out;
  });
}

/** Device link lost: its live sessions can't be observed any more. */
export async function markDeviceSessionsDisconnected(ctx: AppContext, deviceId: string): Promise<number> {
  const r = await ctx.prisma.agentSession.updateMany({
    where: { deviceId, endedAt: null, status: { not: 'Stopped' } },
    data: { status: 'Disconnected' },
  });
  return r.count;
}
