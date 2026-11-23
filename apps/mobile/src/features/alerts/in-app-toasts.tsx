import { NotificationPage } from '@pocket-agent/protocol';
import { usePathname, useRouter } from 'expo-router';
import { AppState } from 'react-native';
import { apiRequest } from '@/lib/api';
import { markRead } from '@/lib/data';
import { useLiveEvents } from '@/lib/live';
import { routeForLink } from '@/lib/links';
import { useToast } from '@/ui/toast';

/** The path of this app's screen that a notification link opens (`/chat/<id>`, `/approvals`, …). */
function pathForLink(link: string): string {
  const href = routeForLink(link);
  if (typeof href === 'string') return href;
  const { pathname, params } = href as { pathname: string; params?: Record<string, string> };
  return pathname.replace(/\[(\w+)\]/g, (_, k: string) => params?.[k] ?? '');
}

/**
 * While the app is on screen, a new notification shows as a toast here (the phone's own
 * notification is for when the app is in the background or closed). Nothing is shown for the screen
 * you are looking at (the chat that finished, the approvals you are reading): it's in front of you.
 */
export function InAppToasts() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useLiveEvents((e) => {
    if (e.eventType !== 'notification.created' || AppState.currentState !== 'active') return;
    const id = e.payload.notificationId;
    void apiRequest('/notifications?limit=10', NotificationPage)
      .then(({ notifications }) => {
        const n = notifications.find((x) => x.id === id);
        if (!n || n.readAt || (n.link && pathForLink(n.link) === pathname)) return;
        toast({
          key: n.id,
          title: n.title,
          body: n.body,
          onPress: () => {
            void markRead({ ids: [n.id] }).catch(() => undefined);
            if (n.link) router.push(routeForLink(n.link));
          },
        });
      })
      .catch(() => undefined);
  });

  return null;
}
