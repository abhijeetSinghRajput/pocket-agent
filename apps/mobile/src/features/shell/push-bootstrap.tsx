import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { markRead } from '@/lib/data';
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

    const open = (response: Notifications.NotificationResponse) => {
      const { link, notificationId } = notificationLink(response.notification);
      if (notificationId) void markRead({ ids: [notificationId] }).catch(() => undefined);
      router.push(routeForLink(link));
    };
    // The app may have been opened by a tap while it was closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
  return null;
}
