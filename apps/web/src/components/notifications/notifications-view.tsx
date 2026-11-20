'use client';

import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import { Bell, BellOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { markRead, useNotifications } from '@/lib/use-notifications';
import { cn } from '@/lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  permission_required: 'Permission',
  agent_failed: 'Failed',
  device_disconnected: 'PC offline',
  task_completed: 'Finished',
  agent_started: 'Started',
  test: 'Test',
};

function pushNote(n: NotificationDto): string | null {
  if (n.push.sent > 0) return null;
  switch (n.push.skipped) {
    case 'quiet_hours':
      return 'Not pushed (quiet hours)';
    case 'no_browser_registered':
      return 'Not pushed (no browser enabled)';
    case 'push_not_configured':
      return null; // stated once in Settings, not on every row
    case 'send_failed':
      return 'Push delivery failed';
    default:
      return null;
  }
}

function Row({ n, onOpen }: { n: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  const unread = !n.readAt;
  const note = pushNote(n);
  const body = (
    <div className="flex gap-3 px-4 py-3.5">
      <span
        aria-hidden
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn('text-sm [overflow-wrap:anywhere]', unread ? 'font-semibold' : 'font-medium')}>
            {n.title}
          </p>
          <Badge variant={n.priority === 'critical' ? 'warning' : 'neutral'}>
            {CATEGORY_LABEL[n.category] ?? n.category}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-pretty [overflow-wrap:anywhere] text-muted-foreground">{n.body}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <time dateTime={n.createdAt} title={formatDate(n.createdAt)}>
            {timeAgo(n.createdAt)}
          </time>
          {note && <span> · {note}</span>}
        </p>
      </div>
    </div>
  );
  return (
    <li data-testid="notification" data-unread={unread || undefined}>
      {n.link ? (
        <Link
          href={n.link}
          onClick={() => onOpen(n)}
          className="block outline-none hover:bg-accent/50 focus-visible:bg-accent"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export function NotificationsView() {
  const { state, refresh } = useNotifications(30);
  const [older, setOlder] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const first = state.data;
  const next = cursor === undefined ? (first?.nextCursor ?? null) : cursor;
  const items = [
    ...(first?.notifications ?? []),
    ...older.filter((o) => !first?.notifications.some((f) => f.id === o.id)),
  ];

  const open = (n: NotificationDto) => {
    if (!n.readAt) void markRead([n.id]).then(refresh, () => undefined);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything Pocket Agent told you about. Push is only a hint; this history is the record."
        actions={
          first && first.unread > 0 ? (
            <Button
              variant="outline"
              size="sm"
              data-testid="mark-all-read"
              onClick={async () => {
                setError(null);
                try {
                  await markRead();
                  setOlder((o) => o.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
                  await refresh();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {(error || state.error) && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error ?? state.error}
        </p>
      )}
      {state.status === 'loading' && (
        <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      )}
      {state.status === 'ready' && items.length === 0 && (
        <section
          data-testid="no-notifications"
          className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <BellOff className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold">No notifications yet</h2>
          <p className="mt-2 max-w-md text-sm text-pretty text-muted-foreground">
            You’ll hear about permission requests, failures, finished turns and offline PCs. Choose what and
            when in{' '}
            <Link href="/settings" className="font-medium text-foreground underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        </section>
      )}
      {items.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((n) => (
            <Row key={n.id} n={n} onOpen={open} />
          ))}
        </ul>
      )}
      {next && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                const page = await apiRequest(`/notifications?limit=30&before=${next}`, NotificationPage);
                setOlder((o) => [...o, ...page.notifications]);
                setCursor(page.nextCursor);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Bell aria-hidden /> Load older
          </Button>
        </div>
      )}
    </>
  );
}
