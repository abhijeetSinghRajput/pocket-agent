import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { answerFromNotification, registerPushActions, registerPushTask } from '@/features/shell/push-actions';
import { markRead } from '@/lib/data';
import { useLiveEvents } from '@/lib/live';
import { routeForLink } from '@/lib/links';
import { installForegroundHandler, notificationLink, refreshPushRegistration } from '@/lib/push';

/**
 * Mounted once inside the signed-in app: tapping a notification (also the one that opened the
 * app) marks it read and opens what it points to; the registration is kept current.
 */
export function PushBootstrap() {
  const router = useRouter();
  useEffect(() => {
    installForegroundHandler();
    void refreshPushRegistration();
    void registerPushActions().catch(() => undefined);
    void registerPushTask().catch(() => undefined);

    const open = async (response: Notifications.NotificationResponse) => {
      // Allow / Deny: answered right there, the app stays where it is.
      if (await answerFromNotification(response)) return;
      const { link, notificationId } = notificationLink(response.notification);
      if (notificationId) void markRead({ ids: [notificationId] }).catch(() => undefined);
      router.push(routeForLink(link));
    };
    // The app may have been opened by a tap while it was closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      // Handled once: signing in again (or leaving setup) must not reopen it.
      Notifications.clearLastNotificationResponse();
      void open(last);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void open(r));
    return () => sub.remove();
  }, [router]);

  // Answered anywhere (here, the web, the PC), expired or cancelled: its notification leaves the
  // shade (the server sends it tagged with the request).
  useLiveEvents((e) => {
    if (e.eventType === 'approval.updated' && e.payload.status !== 'Pending')
      void Notifications.dismissNotificationAsync(`approval:${e.payload.approvalId}`).catch(() => undefined);
  });
  return null;
}
