import type { BackendToWeb } from '@agentdock/protocol';
import type { FastifyInstance } from 'fastify';
import { notify, type NotifyServices } from './service.js';

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
        title: `Permission needed · ${a.toolName}`,
        body: `${a.session.projectName} on ${a.device.name}. Tap to review.`,
        link: '/approvals',
        dedupeKey: `approval:${a.id}`,
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
      if (status === 'Failed') {
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
      body: 'AgentDock lost contact with this PC. Its sessions can’t be reached until it’s back.',
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
