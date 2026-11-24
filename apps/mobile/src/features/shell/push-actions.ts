import { PUSH_PERMISSION_CATEGORY } from '@pocket-agent/protocol';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { sendDecision } from '@/features/approvals/shared';
import { ApiClientError } from '@/lib/api';
import { markRead } from '@/lib/data';
import { notificationLink } from '@/lib/push';
import { getToken, loadToken } from '@/lib/session';

/**
 * Allow / Deny on a permission request's notification: answered from the notification shade,
 * without opening the app (also while it is closed).
 */
const DECISIONS = ['allow', 'deny'] as const;
type Decision = (typeof DECISIONS)[number];
const isDecision = (id: string): id is Decision => (DECISIONS as readonly string[]).includes(id);

/** Runs when Android wakes the app for a notification button (the app may be closed). */
const TASK = 'pocket-agent.notification-actions';

/** Registers the button set (Android keeps it, also for when the app is closed). */
export async function registerPushActions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationCategoryAsync(PUSH_PERMISSION_CATEGORY, [
    { identifier: 'allow', buttonTitle: 'Allow', options: { opensAppToForeground: false } },
    {
      identifier: 'deny',
      buttonTitle: 'Deny',
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
}

// A tap may reach both the open app's listener and the background task: answered once.
const handled = new Set<string>();

/**
 * A tap on Allow or Deny: sends the decision, marks the notification read and takes it off the
 * shade. If it couldn't be answered (expired, PC offline…) a notification says so. Returns false
 * for any other tap (opening the notification), which the caller handles.
 */
export async function answerFromNotification(response: Notifications.NotificationResponse): Promise<boolean> {
  const decision = response.actionIdentifier;
  if (!isDecision(decision)) return false;
  const { request } = response.notification;
  const approvalId = (request.content.data ?? {})['approvalId'];
  if (typeof approvalId !== 'string') return false;
  const once = `${request.identifier}:${decision}`;
  if (handled.has(once)) return true;
  handled.add(once);

  // Woken while closed: the session is read from secure storage first.
  if (!getToken()) await loadToken();
  const { link, notificationId } = notificationLink(response.notification);
  try {
    await sendDecision(approvalId, { decision });
  } catch (err) {
    // Already answered (here, on the PC, or by the other button): nothing to say.
    if (!(err instanceof ApiClientError && err.code === 'already_decided')) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Not answered',
          body: `${(err as Error).message} Open Pocket Agent to check.`,
          data: { link: link ?? '/approvals' },
        },
        trigger: { channelId: 'approvals' },
      }).catch(() => undefined);
    }
  }
  if (notificationId) await markRead({ ids: [notificationId] }).catch(() => undefined);
  await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
  return true;
}

// Must be defined when the JS bundle loads (index.js imports this file): Android may start the app
// in the background only to run it.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
  if (data && 'actionIdentifier' in data) await answerFromNotification(data);
});

/** Lets Android run the task for button taps while the app is in the background or closed. */
export async function registerPushTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.registerTaskAsync(TASK);
}
