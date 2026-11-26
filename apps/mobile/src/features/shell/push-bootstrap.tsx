import * as Notifications from 'expo-notifications';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { answerFromNotification, registerPushActions, registerPushTask } from '@/features/shell/push-actions';
import { markRead } from '@/lib/data';
import { useLiveEvents } from '@/lib/live';
import { chatIdOfLink, routeForLink } from '@/lib/links';
import { installForegroundHandler, notificationLink, refreshPushRegistration } from '@/lib/push';

/**
 * Mounted once inside the signed-in app: tapping a notification (also the one that opened the
 * app) marks it read and opens what it points to; the registration is kept current.
 */
export function PushBootstrap() {
  const router = useRouter();
  // Where the app is now (also when it comes back from the background on a tap).
  const pathname = usePathname();
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);
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
      // A notification opens its screen on a clean stack: the tabs (the chat list for a chat)
      // with that one screen on top, so Back goes to the list. `push` alone would stack a second
      // copy of the chat already open (Back then showed the same chat again).
      const chat = chatIdOfLink(link);
      if (chat && here.current === `/chat/${chat}`) return;
      if (router.canDismiss()) router.dismissAll();
      if (chat) {
        router.navigate('/');
        router.push(routeForLink(link));
      } else router.navigate(routeForLink(link));
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
