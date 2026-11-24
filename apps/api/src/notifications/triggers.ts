import type { BackendToWeb } from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import type { PushAction } from './push.js';
import { notify, type NotifyServices } from './service.js';

/**
 * Buttons on the notification, only for a plain yes/no: a permission request (Allow / Deny), or a
 * question from Claude with exactly two options and one choice. Anything with more choices (radio
 * or checkbox) opens the app instead.
 */
export function yesNoActions(a: { id: string; toolName: string; requestPayload: unknown }): {
  actions?: PushAction[];
} {
  if (a.toolName !== 'AskUserQuestion') {
    return {
      actions: [
        { id: 'allow', title: 'Allow', approvalId: a.id, decision: 'allow' },
        { id: 'deny', title: 'Deny', approvalId: a.id, decision: 'deny' },
      ],
    };
  }
  try {
    const input = (a.requestPayload as { input?: unknown } | null)?.input;
    const q = (JSON.parse(typeof input === 'string' ? input : '{}') as { questions?: unknown }).questions;
    if (!Array.isArray(q) || q.length !== 1) return {};
    const only = q[0] as { question?: unknown; multiSelect?: unknown; options?: unknown };
    const options = Array.isArray(only.options) ? (only.options as Array<{ label?: unknown }>) : [];
    if (typeof only.question !== 'string' || only.multiSelect === true || options.length !== 2) return {};
    const labels = options.map((o) => (typeof o.label === 'string' ? o.label : ''));
    if (labels.some((l) => !l)) return {};
    return {
      actions: labels.map((label, i) => ({
        id: `answer-${i}`,
        title: label.slice(0, 40),
        approvalId: a.id,
        decision: 'allow' as const,
        answers: { [only.question as string]: label },
      })),
    };
  } catch {
    return {};
  }
}

/** Turns what just happened (browser events from ingest) into notifications. Best effort. */
export async function notifyFromEvents(ctx: NotifyServices, events: BackendToWeb[]): Promise<void> {
  for (const e of events) {
    if (e.eventType === 'approval.created') {
      const a = await ctx.prisma.approval.findUnique({
        where: { id: e.payload.approvalId },
        include: { session: true, device: true },
      });
      if (!a) continue;
      await notify(ctx, {
        userId: a.userId,
        category: 'permission_required',
        // No command text in the push itself (it passes through Google/Apple); the app shows it.
        title:
          a.toolName === 'AskUserQuestion' ? 'Claude is asking you' : `Permission needed · ${a.toolName}`,
        body: `${a.session.projectName} on ${a.device.name}. Tap to review.`,
        link: a.toolName === 'AskUserQuestion' ? `/agents/${a.sessionId}` : '/approvals',
        dedupeKey: `approval:${a.id}`,
        ...yesNoActions(a),
      });
      continue;
    }

    if (e.eventType === 'agent.status.changed' && e.sessionId) {
      const s = await ctx.prisma.agentSession.findUnique({
        where: { id: e.sessionId },
        include: { device: true },
      });
      if (!s) continue;
      const base = { userId: s.device.userId, link: `/agents/${s.id}` };
      const { status, previous } = e.payload;
      if (status === 'WaitingForPermission' && previous !== 'WaitingForPermission') {
        // Held for Pocket Agent: approval.created already notifies (with Allow / Deny).
        const held = await ctx.prisma.approval.count({ where: { sessionId: s.id, status: 'Pending' } });
        if (held) continue;
        // Asked on the PC only: the phone hears about it too, and is told where to answer.
        const asked = await ctx.prisma.agentEvent.findFirst({
          where: { sessionId: s.id, eventType: 'agent.permission.requested' },
          orderBy: { createdAt: 'desc' },
          select: { payload: true },
        });
        const tool = (asked?.payload as { toolName?: unknown } | undefined)?.toolName;
        await notify(ctx, {
          ...base,
          category: 'permission_required',
          title:
            tool === 'AskUserQuestion'
              ? `Claude is asking you · ${s.projectName}`
              : `Permission needed · ${typeof tool === 'string' ? tool : s.projectName}`,
          body: `Answer it on ${s.device.name}.`,
          dedupeKey: `on-pc:${s.id}:${e.eventId}`,
        });
      } else if (status === 'Failed') {
        await notify(ctx, {
          ...base,
          category: 'agent_failed',
          title: `Agent failed · ${s.projectName}`,
          body: `A turn ended with an error on ${s.device.name}.`,
          dedupeKey: `failed:${s.id}:${e.eventId}`,
        });
      } else if (
        status === 'WaitingForInput' &&
        (previous === 'Running' || previous === 'WaitingForPermission') &&
        // When you're at the PC, a finished turn in your own VS Code session isn't news.
        (s.mode === 'managed' || s.device.awayMode)
      ) {
        await notify(ctx, {
          ...base,
          category: 'task_completed',
          title: `Claude finished · ${s.projectName}`,
          body: `Waiting for your next instruction on ${s.device.name}.`,
          dedupeKey: `done:${s.id}:${e.eventId}`,
        });
      } else if (previous === null && status !== 'Stopped') {
        await notify(ctx, {
          ...base,
          category: 'agent_started',
          title: `Session started · ${s.projectName}`,
          body: `On ${s.device.name}.`,
          dedupeKey: `started:${s.id}`,
        });
      }
    }
  }
}

/** Offline for this long before we notify (a quick restart doesn't page anyone). */
export const OFFLINE_NOTIFY_AFTER_MS = 2 * 60 * 1000;

export async function notifyOfflineDevices(ctx: NotifyServices): Promise<number> {
  const now = ctx.now().getTime();
  const devices = await ctx.prisma.device.findMany({
    where: {
      status: 'Offline',
      revokedAt: null,
      lastHeartbeatAt: { lt: new Date(now - OFFLINE_NOTIFY_AFTER_MS), gt: new Date(now - 24 * 3600_000) },
    },
    take: 200,
  });
  let n = 0;
  for (const d of devices) {
    const r = await notify(ctx, {
      userId: d.userId,
      category: 'device_disconnected',
      title: `PC offline · ${d.name}`,
      body: 'Pocket Agent lost contact with this PC. Its sessions can’t be reached until it’s back.',
      link: '/devices',
      // One notification per offline episode.
      dedupeKey: `offline:${d.id}:${d.lastHeartbeatAt!.toISOString()}`,
    });
    if (r) n++;
  }
  return n;
}

export async function offlineNotifierJob(
  app: FastifyInstance,
  ctx: NotifyServices & { offlineCheckMs?: number },
) {
  const timer = setInterval(() => {
    void notifyOfflineDevices(ctx).catch((err: unknown) => app.log.warn({ err }, 'offline notifier failed'));
  }, ctx.offlineCheckMs ?? 30_000);
  app.addHook('onClose', async () => clearInterval(timer));
}
