import {
  createEvent,
  isQuietTime,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationDto,
  type NotificationPriority,
  type NotificationSettingsDto,
  type QuietHours,
} from '@pocket-agent/protocol';
import type { AppContext } from '../context.js';
import { Prisma, type Notification } from '../generated/prisma/client.js';
import { notifyUser, type Bus } from '../realtime/bus.js';
import type { PushAction, PushSender } from './push.js';

export type NotifyServices = AppContext & { bus: Bus; push: PushSender };

export interface NotifyInput {
  userId: string;
  category: NotificationCategory | 'test';
  title: string;
  body: string;
  link: string;
  /** Same key → one notification (an event never notifies twice). */
  dedupeKey: string;
  /** Buttons for a yes/no request (see `yesNoActions`). */
  actions?: PushAction[];
}

export function toNotificationDto(n: Notification): NotificationDto {
  const data = (n.data ?? {}) as { link?: unknown };
  return {
    id: n.id,
    category: n.type,
    priority: n.priority as NotificationPriority,
    title: n.title,
    body: n.body,
    link: typeof data.link === 'string' ? data.link : null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    push: { sent: n.pushSent, skipped: n.pushSkipped },
  };
}

export async function loadSettings(ctx: NotifyServices, userId: string): Promise<NotificationSettingsDto> {
  const [prefs, s, subscriptions] = await Promise.all([
    ctx.prisma.notificationPreference.findMany({ where: { userId } }),
    ctx.prisma.notificationSettings.findUnique({ where: { userId } }),
    ctx.prisma.pushSubscription.count({ where: { userId } }),
  ]);
  const categories = Object.fromEntries(
    (Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((c) => [
      c,
      prefs.find((p) => p.category === c)?.enabled ?? NOTIFICATION_CATEGORIES[c].defaultEnabled,
    ]),
  ) as Record<NotificationCategory, boolean>;
  const quietHours: QuietHours | null =
    s?.quietStart && s.quietEnd ? { start: s.quietStart, end: s.quietEnd, timezone: s.timezone } : null;
  return { categories, quietHours, push: { available: ctx.push.available, subscriptions } };
}

/**
 * Records a notification (history is the source of truth) and pushes it to the user's browsers
 * when allowed. Respects category preferences and quiet hours (only critical pushes during quiet
 * hours). Never throws into the caller's flow.
 */
export async function notify(ctx: NotifyServices, input: NotifyInput): Promise<Notification | null> {
  const settings = await loadSettings(ctx, input.userId);
  const priority: NotificationPriority =
    input.category === 'test' ? 'high' : NOTIFICATION_CATEGORIES[input.category].priority;
  if (input.category !== 'test' && !settings.categories[input.category]) return null;

  let n: Notification;
  try {
    n = await ctx.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.category,
        priority,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 500),
        data: { link: input.link },
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // duplicate
    throw err;
  }
  await notifyUser(ctx.bus, input.userId, createEvent('notification.created', { notificationId: n.id }));

  // Push (best effort).
  let skipped: string | null = null;
  let sent = 0;
  if (!ctx.push.available) skipped = 'push_not_configured';
  else if (priority !== 'critical' && isQuietTime(settings.quietHours, ctx.now())) skipped = 'quiet_hours';
  else {
    const subs = await ctx.prisma.pushSubscription.findMany({ where: { userId: input.userId } });
    if (!subs.length) skipped = 'no_browser_registered';
    for (const sub of subs) {
      const r = await ctx.push
        .send(sub.token, {
          title: n.title,
          body: n.body,
          link: input.link,
          tag: input.dedupeKey.slice(0, 100),
          priority,
          ...(input.actions?.length ? { actions: input.actions } : {}),
        })
        .catch(() => 'error' as const);
      if (r === 'ok') {
        sent++;
        await ctx.prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: ctx.now(), lastError: null },
        });
      } else if (r === 'invalid_token') {
        await ctx.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      } else {
        await ctx.prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastError: 'send_failed' },
        });
      }
    }
    if (subs.length && !sent) skipped = 'send_failed';
  }
  return ctx.prisma.notification.update({
    where: { id: n.id },
    data: { pushSent: sent, pushSkipped: skipped },
  });
}
