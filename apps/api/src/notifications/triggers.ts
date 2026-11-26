import { agentName } from '@pocket-agent/core';
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
    // "Allow for session" only when the PC offered it for this request (phone: a third button).
    const offered = typeof (a.requestPayload as { remember?: unknown } | null)?.remember === 'string';
    return {
      actions: [
        { id: 'allow', title: 'Allow', approvalId: a.id, decision: 'allow' },
        { id: 'deny', title: 'Deny', approvalId: a.id, decision: 'deny' },
        ...(offered
          ? [
              {
                id: 'allow-session',
                title: 'Allow for session',
                approvalId: a.id,
                decision: 'allow' as const,
                remember: true,
              },
            ]
          : []),
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

/**
 * What Claude wants to do, in plain words, for a permission notification. Never the command or
 * the file itself: a push passes through Google's servers.
 */
export function wantsTo(toolName: string, deviceName: string): string {
  const on = `on ${deviceName}`;
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return `Wants to run a command ${on}`;
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return `Wants to change a file ${on}`;
    case 'Read':
      return `Wants to read a file ${on}`;
    case 'WebFetch':
    case 'WebSearch':
      return `Wants to look something up on the web`;
    default:
      return `Wants to use ${toolName} ${on}`;
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
      const asking = a.toolName === 'AskUserQuestion';
      const agent = agentName(a.session.provider);
      await notify(ctx, {
        userId: a.userId,
        category: 'permission_required',
        // Plain words, the chat's name in the header; no command text in the push itself (it
        // passes through Google/Apple), the app shows it.
        title: asking ? `${agent} has a question` : `${agent} needs your OK`,
        body: asking ? 'Tap to answer.' : wantsTo(a.toolName, a.device.name),
        subtitle: a.session.projectName,
        group: a.sessionId,
        link: asking ? `/agents/${a.sessionId}` : '/approvals',
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
      const agent = agentName(s.provider);
      // Each chat's notifications stack together, under its name.
      const base = {
        userId: s.device.userId,
        link: `/agents/${s.id}`,
        subtitle: s.projectName,
        group: s.id,
      };
      const { status, previous } = e.payload;
      // Answered on the PC: its "Answer it on the PC" notification is done with.
      if (previous === 'WaitingForPermission' && status !== 'WaitingForPermission') {
        await ctx.prisma.notification.updateMany({
          where: { userId: base.userId, dedupeKey: { startsWith: `on-pc:${s.id}:` }, readAt: null },
          data: { readAt: ctx.now() },
        });
      }
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
          title: tool === 'AskUserQuestion' ? `${agent} has a question` : `${agent} needs your OK`,
          body: `Answer it on ${s.device.name}.`,
          dedupeKey: `on-pc:${s.id}:${e.eventId}`,
        });
      } else if (status === 'Failed') {
        await notify(ctx, {
          ...base,
          category: 'agent_failed',
          title: 'Something went wrong',
          body: `${agent} stopped with an error on ${s.device.name}.`,
          dedupeKey: `failed:${s.id}:${e.eventId}`,
          // Only the latest one per chat stays on the phone.
          replaces: `failed:${s.id}`,
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
          title: `${agent} is done`,
          body: 'Waiting for your next message.',
          dedupeKey: `done:${s.id}:${e.eventId}`,
          // Only the latest one per chat stays on the phone.
          replaces: `done:${s.id}`,
        });
      } else if (previous === null && status !== 'Stopped') {
        await notify(ctx, {
          ...base,
          category: 'agent_started',
          title: 'New chat started',
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
  // One notification per offline episode: skip the ones already sent, in one query.
  const keyOf = (d: (typeof devices)[number]) => `offline:${d.id}:${d.lastHeartbeatAt!.toISOString()}`;
  const sent = devices.length
    ? await ctx.prisma.notification.findMany({
        where: {
          userId: { in: [...new Set(devices.map((d) => d.userId))] },
          dedupeKey: { in: devices.map(keyOf) },
        },
        select: { userId: true, dedupeKey: true },
      })
    : [];
  const done = new Set(sent.map((x) => `${x.userId} ${x.dedupeKey}`));
  let n = 0;
  for (const d of devices) {
    if (done.has(`${d.userId} ${keyOf(d)}`)) continue;
    const r = await notify(ctx, {
      userId: d.userId,
      category: 'device_disconnected',
      title: 'Your PC went offline',
      body: 'Its chats can’t be reached until it’s back.',
      subtitle: d.name,
      group: `device:${d.id}`,
      link: '/devices',
      dedupeKey: keyOf(d),
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
