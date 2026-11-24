'use client';

import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import { Bell, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { markRead } from '@/lib/use-notifications';

const SHOW_MS = 6000;
const MAX = 3;

/**
 * While the app is open, a new notification shows as a toast here (the phone's own notification
 * is only for when the app is in the background or closed; the service worker skips it while the
 * app is on screen). Nothing is shown for the chat you are looking at: you can already see it.
 */
export function InAppToasts() {
  const [toasts, setToasts] = useState<NotificationDto[]>([]);
  const pathname = usePathname();
  const router = useRouter();
  const where = useRef(pathname);
  useEffect(() => {
    where.current = pathname;
  }, [pathname]);

  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useLiveEvents((e) => {
    if (e.eventType !== 'notification.created' || document.visibilityState !== 'visible') return;
    const id = e.payload.notificationId;
    void apiRequest('/notifications?limit=10', NotificationPage)
      .then(({ notifications }) => {
        const n = notifications.find((x) => x.id === id);
        // Already on that page (e.g. the chat that finished): it's in front of you.
        if (!n || n.readAt || (n.link && n.link === where.current)) return;
        // A permission request or question is already on screen while the app is open: in its
        // chat, as the pop-up sheet anywhere else, listed on Approvals. A toast would repeat it.
        if (n.category === 'permission_required') return;
        setToasts((t) => [n, ...t.filter((x) => x.id !== n.id)].slice(0, MAX));
        setTimeout(() => dismiss(n.id), SHOW_MS);
      })
      .catch(() => undefined);
  });

  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
      aria-live="polite"
      data-testid="in-app-toasts"
    >
      {toasts.map((n) => (
        <div
          key={n.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-popover p-3.5 text-popover-foreground shadow-lg transition-[transform,opacity] duration-300 ease-(--ease-out) starting:-translate-y-3 starting:opacity-0 motion-reduce:starting:translate-y-0"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none"
            onClick={() => {
              dismiss(n.id);
              void markRead([n.id]).catch(() => undefined);
              if (n.link) router.push(n.link);
            }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
              <Bell className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 pt-0.5">
              {n.subtitle && (
                <span className="block truncate text-xs text-muted-foreground">{n.subtitle}</span>
              )}
              <span className="block truncate text-sm font-semibold">{n.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{n.body}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
