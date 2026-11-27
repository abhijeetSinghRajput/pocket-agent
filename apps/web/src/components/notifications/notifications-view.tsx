'use client';

import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import {
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MonitorOff,
  Play,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { apiRequest } from '@/lib/api';
import { formatDate, recentSections, timeAgo } from '@/lib/format';
import { markRead, useNotifications } from '@/lib/use-notifications';
import { webPath } from '@/lib/nav';
import { cn } from '@/lib/utils';

// The web port of the app's Alerts screen (apps/mobile/src/features/alerts/alerts-screen.tsx):
// Unread and All, flat rows by day, an icon in the tone of what happened, unread ones on a light
// wash of the accent (no dot), the time as short as a phone's notification shade says it.

type Tone = 'warning' | 'danger' | 'muted' | 'success' | 'primary';

/** What each kind of alert looks like: an icon in the tone of what happened. */
const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  permission_required: { icon: ShieldAlert, tone: 'warning' },
  agent_failed: { icon: CircleAlert, tone: 'danger' },
  device_disconnected: { icon: MonitorOff, tone: 'muted' },
  task_completed: { icon: CircleCheck, tone: 'success' },
  agent_started: { icon: Play, tone: 'primary' },
  test: { icon: Bell, tone: 'muted' },
};
const DEFAULT_LOOK = { icon: Bell, tone: 'muted' as Tone };

/** The app's IconTile: the icon on a soft wash of its tone. */
const TILE: Record<Tone, string> = {
  warning: 'bg-warning/14 text-warning',
  danger: 'bg-destructive/14 text-destructive',
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-success/14 text-success',
  primary: 'bg-primary/14 text-primary',
};

type Tab = 'unread' | 'all';
const TABS = [
  { value: 'unread', label: 'Unread' },
  { value: 'all', label: 'All' },
] as const;

/** "now", "5m", "2h", "3d": how long ago, as short as a phone's notification shade says it. */
function shortAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

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

/** One notification as a full-width row. Unread ones sit on a light wash of the accent, which eases out when read. */
function Row({
  n,
  unread,
  divider,
  onOpen,
}: {
  n: NotificationDto;
  unread: boolean;
  divider: boolean;
  onOpen: (n: NotificationDto) => void;
}) {
  const note = pushNote(n);
  const look = LOOK[n.category] ?? DEFAULT_LOOK;
  const Icon = look.icon;
  const title = (
    <p className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>{n.title}</p>
  );
  const body = (
    <div className="flex items-start gap-3.5 px-5 py-3.5">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', TILE[look.tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* What it is about (the chat), small, with the time: the title reads on its own below. */}
          <div className="min-w-0 flex-1">
            {n.subtitle ? <p className="truncate text-xs text-muted-foreground">{n.subtitle}</p> : title}
          </div>
          <time
            dateTime={n.createdAt}
            title={`${timeAgo(n.createdAt)} · ${formatDate(n.createdAt)}`}
            className={cn('shrink-0 text-xs tabular-nums', unread ? 'text-primary' : 'text-muted-foreground')}
          >
            {shortAgo(n.createdAt)}
          </time>
        </div>
        {n.subtitle && <div className="mt-px">{title}</div>}
        <p
          className={cn(
            'mt-px line-clamp-2 text-sm [overflow-wrap:anywhere]',
            unread ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {n.body}
        </p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
  return (
    <li
      data-testid="notification"
      data-unread={unread || undefined}
      className={cn(
        'relative transition-colors duration-200 ease-(--ease-out)',
        unread ? 'bg-primary/10' : 'bg-transparent',
      )}
    >
      {divider && <span aria-hidden className="absolute top-0 right-0 left-[74px] h-px bg-border" />}
      {n.link ? (
        <Link
          href={webPath(n.link)}
          onClick={() => onOpen(n)}
          aria-label={`${unread ? 'Unread. ' : ''}${n.subtitle ? `${n.subtitle}: ` : ''}${n.title}. ${n.body}. ${timeAgo(n.createdAt)}`}
          className="block outline-none hover:bg-accent/50 focus-visible:bg-accent active:scale-[0.99]"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function Empty({ tab }: { tab: Tab }) {
  return tab === 'unread' ? (
    <section data-testid="no-unread-notifications" className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <CheckCheck className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold">You&apos;re all caught up</h2>
      <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
        New permission requests, failures and finished turns show up here.
      </p>
    </section>
  ) : (
    <section data-testid="no-notifications" className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <BellOff className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold">No notifications yet</h2>
      <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
        Permission requests, failures and finished turns show up here. Choose which in{' '}
        <Link href="/profile" className="font-medium text-foreground underline underline-offset-4">
          your profile
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * Notification history, newest first, by day, as the phone's own notification list draws it: flat
 * rows, unread ones on a light wash. Unread and All, one control apart. Opening a notification marks
 * it read and goes where it points.
 */
export function NotificationsView() {
  const { state, refresh } = useNotifications(30);
  const [older, setOlder] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Read here: they lose their wash at once, and stay in Unread until you leave the page.
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(new Set());
  const [tab, setTab] = useState<Tab>('unread');
  // All: older than a week stays folded away until asked for. Unread: everything unread shows.
  const [showEarlier, setShowEarlier] = useState(false);

  const first = state.data;
  const next = cursor === undefined ? (first?.nextCursor ?? null) : cursor;
  const items = useMemo(
    () => [
      ...(first?.notifications ?? []),
      ...older.filter((o) => !first?.notifications.some((f) => f.id === o.id)),
    ],
    [first, older],
  );

  const { shown, hidden } = useMemo(() => {
    const list = tab === 'unread' ? items.filter((n) => !n.readAt || readNow.has(n.id)) : items;
    const { sections, earlier } = recentSections(list);
    const open = tab === 'unread' || showEarlier;
    return {
      shown: [...sections, ...(open && earlier.length ? [{ label: 'Earlier', items: earlier }] : [])],
      hidden: open ? 0 : earlier.length,
    };
  }, [items, tab, showEarlier, readNow]);

  async function showMore() {
    // First what is already here but folded away; after that, older pages from the server.
    if (hidden > 0) return setShowEarlier(true);
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await apiRequest(`/notifications?limit=30&before=${next}`, NotificationPage);
      setOlder((o) => [...o, ...page.notifications]);
      setCursor(page.nextCursor);
      setShowEarlier(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const open = (n: NotificationDto) => {
    if (!n.readAt) {
      setReadNow((s) => new Set(s).add(n.id));
      void markRead([n.id]).then(refresh, () => undefined);
    }
  };

  async function markAll() {
    setError(null);
    const unread = items.filter((n) => !n.readAt).map((n) => n.id);
    setReadNow((s) => new Set([...s, ...unread]));
    try {
      await markRead();
      setOlder((o) => o.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      await refresh();
    } catch (err) {
      setReadNow((s) => new Set([...s].filter((id) => !unread.includes(id))));
      setError((err as Error).message);
    }
  }

  const unreadCount = first ? items.filter((n) => !n.readAt && !readNow.has(n.id)).length : 0;
  const canMore = shown.length > 0 && (hidden > 0 || (tab === 'all' && !!next));

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          first && first.unread > 0 && unreadCount > 0 ? (
            <Button variant="outline" size="sm" data-testid="mark-all-read" className="content-in" onClick={() => void markAll()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <Segmented
        options={TABS}
        value={tab}
        onChange={setTab}
        label="Which notifications"
        as="tab"
        className="mb-4 flex w-full sm:max-w-xs [&>button]:flex-1 [&>button]:justify-center"
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
        <div aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3.5 px-5 py-3.5">
              <div className="size-10 animate-pulse rounded-xl bg-muted" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Nothing at all yet: say what will come (either tab); nothing unread: all caught up. */}
      {state.status === 'ready' && shown.length === 0 && <Empty tab={items.length ? tab : 'all'} />}
      <div
        key={tab}
        className="stagger -mx-4 flex flex-col sm:mx-0"
        aria-label={tab === 'unread' ? 'Unread notifications' : 'All notifications'}
        data-testid={`notifications-${tab}`}
      >
        {shown.map((section, i) => (
          <section key={section.label} aria-label={section.label} data-testid="notification-section">
            <h2
              className={cn(
                'px-5 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase',
                i ? 'pt-[18px]' : 'pt-1',
              )}
            >
              {section.label}
            </h2>
            <ul className="sm:overflow-hidden sm:rounded-xl">
              {section.items.map((n, j) => (
                <Row
                  key={n.id}
                  n={n}
                  unread={!n.readAt && !readNow.has(n.id)}
                  divider={j > 0}
                  onOpen={open}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {canMore && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            data-testid="show-more"
            onClick={() => void showMore()}
          >
            <ChevronDown aria-hidden /> {loadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </>
  );
}
