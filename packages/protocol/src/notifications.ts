import { z } from 'zod';

/** Notification categories (plan §6) with their priority and default. */
export const NOTIFICATION_CATEGORIES = {
  permission_required: {
    priority: 'critical',
    defaultEnabled: true,
    label: 'Permission needed',
    description: 'Claude is waiting for you to allow or deny an action.',
  },
  agent_failed: {
    priority: 'high',
    defaultEnabled: true,
    label: 'Agent failed',
    description: 'A turn ended with an error.',
  },
  device_disconnected: {
    priority: 'high',
    defaultEnabled: true,
    label: 'PC offline',
    description: 'A paired PC has been unreachable for 2 minutes.',
  },
  task_completed: {
    priority: 'normal',
    defaultEnabled: true,
    label: 'Claude finished',
    description:
      'Claude finished a task and is waiting for you (managed sessions, or any session in Away mode).',
  },
  agent_started: {
    priority: 'low',
    defaultEnabled: false,
    label: 'Session started',
    description: 'A new Claude Code session appeared on one of your PCs.',
  },
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export const NotificationCategory = z.enum(
  Object.keys(NOTIFICATION_CATEGORIES) as [NotificationCategory, ...NotificationCategory[]],
);
export const NotificationPriority = z.enum(['critical', 'high', 'normal', 'low']);
export type NotificationPriority = z.infer<typeof NotificationPriority>;

const iso = z.iso.datetime({ offset: true });

export const NotificationDto = z.object({
  id: z.string(),
  /** A category, or "test" for test notifications. */
  category: z.string(),
  priority: NotificationPriority,
  title: z.string(),
  body: z.string(),
  /** In-app path to open, e.g. /approvals or /agents/<id>. */
  link: z.string().nullable(),
  readAt: iso.nullable(),
  createdAt: iso,
  /** Whether a push was sent, and to how many browsers. */
  push: z.object({ sent: z.number(), skipped: z.string().nullable() }),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationPage = z.object({
  notifications: z.array(NotificationDto),
  nextCursor: z.string().nullable(),
  unread: z.number(),
});
export type NotificationPage = z.infer<typeof NotificationPage>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const QuietHours = z.object({
  start: time,
  end: time,
  /** IANA time zone, e.g. Asia/Kolkata. */
  timezone: z.string().min(1).max(64),
});
export type QuietHours = z.infer<typeof QuietHours>;

export const NotificationSettingsDto = z.object({
  categories: z.record(NotificationCategory, z.boolean()),
  quietHours: QuietHours.nullable(),
  push: z.object({
    /** The server can send push (Firebase configured). */
    available: z.boolean(),
    /** Browsers/devices registered for push. */
    subscriptions: z.number(),
  }),
});
export type NotificationSettingsDto = z.infer<typeof NotificationSettingsDto>;

export const UpdateNotificationSettings = z.object({
  categories: z.partialRecord(NotificationCategory, z.boolean()).optional(),
  quietHours: QuietHours.nullable().optional(),
});
export type UpdateNotificationSettings = z.infer<typeof UpdateNotificationSettings>;

export const RegisterPushRequest = z.object({
  token: z.string().min(20).max(4096),
  platform: z.literal('web'),
  userAgent: z.string().max(300).optional(),
});
export type RegisterPushRequest = z.infer<typeof RegisterPushRequest>;

export const MarkReadRequest = z.object({
  ids: z.array(z.uuid()).max(200).optional(),
  /** Every notification that opens this in-app path (e.g. a chat, when it is opened). */
  link: z.string().startsWith('/').max(500).optional(),
});
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;

/**
 * True if `at` falls in the quiet window [start, end) in the given time zone. Handles windows that
 * cross midnight (e.g. 22:00–07:00). An invalid time zone counts as "not quiet" (never hides alerts).
 */
export function isQuietTime(q: QuietHours | null, at: Date): boolean {
  if (!q || q.start === q.end) return false;
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: q.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at);
  } catch {
    return false;
  }
  return q.start < q.end ? hhmm >= q.start && hhmm < q.end : hhmm >= q.start || hhmm < q.end;
}
