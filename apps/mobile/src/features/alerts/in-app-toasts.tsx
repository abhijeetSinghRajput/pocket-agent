import { NotificationPage } from '@pocket-agent/protocol';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { apiRequest } from '@/lib/api';
import { markRead } from '@/lib/data';
import { foreground, useLiveEvents } from '@/lib/live';
import { routeForLink } from '@/lib/links';
import { onForegroundPush, type ForegroundPush } from '@/lib/push';
import { useToast } from '@/ui/toast';

/** The path of this app's screen that a notification link opens (`/chat/<id>`, `/approvals`, …). */
function pathForLink(link: string): string {
  const href = routeForLink(link);
  if (typeof href === 'string') return href;
  const { pathname, params } = href as { pathname: string; params?: Record<string, string> };
  return pathname.replace(/\[(\w+)\]/g, (_, k: string) => params?.[k] ?? '');
}

interface Shown {
  id: string;
  title: string;
  body: string;
  link: string | null;
  /** A permission request or question: the app's own sheet already shows it. */
  decision: boolean;
}

/**
 * While the app is open, a notification shows as a toast here, never as the phone's own
 * notification (that is for when the app is in the background or closed). It comes from the live
 * updates or from the push itself, whichever is first (one toast per notification). Nothing is
 * shown for the screen you are on (the chat that finished: it's in front of you), and nothing for a
 * permission request or question (the app shows those in its own sheet).
 */
export function InAppToasts() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const show = (n: Shown) => {
    if (n.decision || (n.link && pathForLink(n.link) === pathname)) return;
    toast({
      key: n.id,
      title: n.title,
      body: n.body,
      onPress: () => {
        void markRead({ ids: [n.id] }).catch(() => undefined);
        if (n.link) router.push(routeForLink(n.link));
      },
    });
  };

  // The push, while the app is open (it arrives even when live updates are down).
  const onPush = useEffectEvent((p: ForegroundPush) => {
    if (p.notificationId)
      show({ id: p.notificationId, title: p.title, body: p.body, link: p.link, decision: p.decision });
  });
  useEffect(() => onForegroundPush(onPush), []);

  // Live updates: the notification as stored (unread, and what it links to).
  useLiveEvents((e) => {
    if (e.eventType !== 'notification.created' || !foreground()) return;
    const id = e.payload.notificationId;
    void apiRequest('/notifications?limit=10', NotificationPage)
      .then(({ notifications }) => {
        const n = notifications.find((x) => x.id === id);
        if (!n || n.readAt) return;
        show({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link ?? null,
          decision: n.category === 'permission_required',
        });
      })
      .catch(() => undefined);
  });

  return null;
}
