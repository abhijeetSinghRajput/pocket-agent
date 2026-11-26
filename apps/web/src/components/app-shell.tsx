'use client';

import type { UserDto } from '@pocket-agent/protocol';
import { Moon, Sun } from 'lucide-react';
import { BellIcon } from '@/components/nav-icons';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import { ApprovalPrompt } from '@/components/approvals/approval-prompt';
import { PROFILE_ROUTES, ProfileLink, ProfileRow } from '@/components/user-avatar';
import { ThemeToggle, useMounted, useSmoothTheme } from '@/components/theme';
import { SoundToggle } from '@/components/ui/sound';
import { followStyle, useFollow } from '@/components/ui/segmented';
import { useLiveState } from '@/lib/live';
import { useApprovals } from '@/lib/use-approvals';
import { useNotifications } from '@/lib/use-notifications';
import { isActive, isChatsRoute, NAV_ITEMS, openChatId } from '@/lib/nav';
import { cn } from '@/lib/utils';

function LiveDot() {
  const state = useLiveState();
  const label =
    state === 'live'
      ? 'Live updates on'
      : state === 'connecting'
        ? 'Connecting…'
        : 'Reconnecting… (data refreshes every 30s)';
  return (
    <span
      role="status"
      title={label}
      data-testid="live-indicator"
      data-state={state}
      className="grid size-9 place-items-center"
    >
      <span
        aria-hidden
        className={cn('size-2 rounded-full', state === 'live' ? 'bg-success' : 'animate-pulse bg-warning')}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function NotificationBell() {
  const { state } = useNotifications(1);
  const pathname = usePathname();
  const n = state.data?.unread ?? 0;
  const label = n ? `Notifications, ${n} unread` : 'Notifications';
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      aria-current={pathname === '/notifications' ? 'page' : undefined}
      data-testid="notification-bell"
      className="relative grid size-9 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:text-primary"
    >
      <BellIcon className="size-[18px]" aria-hidden />
      {n > 0 && (
        <span
          aria-hidden
          data-testid="unread-count"
          className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
        >
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}

/** Number of permission requests waiting for a decision (live). */
function usePendingCount(): number {
  const { state } = useApprovals('pending');
  return state.data?.length ?? 0;
}

function PendingBadge() {
  const n = usePendingCount();
  if (!n) return null;
  return (
    <span
      className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-black tabular-nums"
      aria-label={`${n} waiting`}
      data-testid="pending-approvals"
    >
      {n}
    </span>
  );
}

function PendingDot() {
  const n = usePendingCount();
  if (!n) return null;
  return (
    <span
      className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-black tabular-nums"
      aria-label={`${n} waiting`}
      data-testid="pending-approvals-mobile"
    >
      {n}
    </span>
  );
}

export function Logo() {
  return (
    <Link
      href="/chat"
      className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Image src="/icons/logo-64.png" alt="" width={28} height={28} priority className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Pocket Agent</span>
    </Link>
  );
}

/** Theme switch as a row of the menu (same shape as the links above it). */
function ThemeRow() {
  const { resolvedTheme, setTheme } = useSmoothTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === 'dark';
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      data-testid="theme-toggle"
      className="mt-auto flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Icon className="size-[18px] text-foreground" aria-hidden />
      {dark ? 'Light theme' : 'Dark theme'}
      <kbd className="ml-auto rounded border px-1.5 font-mono text-[11px] text-muted-foreground">D</kbd>
    </button>
  );
}

function Sidebar({ pathname, user }: { pathname: string; user: UserDto }) {
  const nav = useRef<HTMLElement>(null);
  const { rect, moving } = useFollow(nav, '[aria-current="page"]', pathname);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <div className="flex items-center">
          <LiveDot />
          <NotificationBell />
        </div>
      </div>
      <nav ref={nav} aria-label="Main" className="relative flex flex-1 flex-col gap-0.5 px-3 py-2">
        {/* The selection slides from one item to the next. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-md bg-accent"
          style={followStyle(rect, moving)}
        />
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active ? 'text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <Icon className={cn('size-[18px]', active ? 'text-primary' : 'text-foreground')} aria-hidden />
              {label}
              {href === '/approvals' && <PendingBadge />}
            </Link>
          );
        })}
        <ThemeRow />
      </nav>
      <div className="border-t p-2">
        <ProfileRow user={user} active={PROFILE_ROUTES.some((h) => isActive(pathname, h))} />
      </div>
    </aside>
  );
}

function MobileTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur-md lg:hidden">
      <Logo />
      <div className="flex items-center">
        <LiveDot />
        <SoundToggle className="size-9 rounded-lg" />
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The bell as a bottom-nav item (phones). */
const BELL = { href: '/notifications', label: 'Alerts', icon: BellIcon } as const;

function UnreadDot() {
  const n = useNotifications(1).state.data?.unread ?? 0;
  if (!n) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
      data-testid="unread-count-mobile"
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function BottomNav({ pathname, user }: { pathname: string; user: UserDto }) {
  const itemClass = (active: boolean) =>
    cn(
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors focus-visible:bg-accent active:bg-accent/60',
      active && 'text-primary',
    );
  const profileActive = PROFILE_ROUTES.some((h) => isActive(pathname, h));
  const unread = useNotifications(1).state.data?.unread ?? 0;
  const nav = useRef<HTMLElement>(null);
  const { rect, moving } = useFollow(nav, '[aria-current="page"]', pathname);
  const BAR = 36;

  return (
    <nav
      ref={nav}
      aria-label="Main"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {/* Flat against the top edge, rounded underneath; slides to the current section. */}
      <span
        aria-hidden
        data-testid="nav-indicator"
        className="pointer-events-none absolute top-0 left-0 h-[3px] rounded-b-full bg-primary"
        style={{
          width: BAR,
          opacity: rect ? 1 : 0,
          transform: `translateX(${rect ? rect.x + rect.w / 2 - BAR / 2 : 0}px)`,
          transition: moving ? 'transform 320ms var(--ease-move), opacity 160ms' : 'none',
        }}
      />
      {/* Notifications sit in the middle of the bar on phones. */}
      {[...NAV_ITEMS.slice(0, 2), BELL, ...NAV_ITEMS.slice(2)].map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            {...(href === BELL.href
              ? {
                  'data-testid': 'notification-bell',
                  'aria-label': unread ? `Alerts, ${unread} unread` : 'Alerts',
                }
              : {})}
            className={itemClass(active)}
          >
            <span className="relative">
              <Icon
                className={cn(
                  'size-5 transition-transform duration-300 ease-(--ease-out)',
                  active ? 'scale-110 text-primary' : 'text-foreground',
                )}
                aria-hidden
              />
              {href === '/approvals' && <PendingDot />}
              {href === BELL.href && <UnreadDot />}
            </span>
            {label}
          </Link>
        );
      })}
      {/* Account, bottom right: just the picture. Settings live inside it. */}
      <div className="flex min-h-14 flex-1 items-center justify-center">
        <ProfileLink user={user} active={profileActive} className="size-11" />
      </div>
    </nav>
  );
}

export function AppShell({ children, user }: { children: ReactNode; user: UserDto }) {
  const pathname = usePathname();
  // Chats is a messenger: edge to edge, and an open chat takes the whole phone screen.
  const chats = isChatsRoute(pathname);
  const chatOpen = !!openChatId(pathname);
  return (
    <div className="flex min-h-dvh">
      <Sidebar pathname={pathname} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        {!chatOpen && <MobileTopBar />}
        <main
          className={cn(
            'w-full min-w-0 flex-1',
            chats
              ? cn('min-w-0', !chatOpen && 'pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0')
              : 'mx-auto max-w-5xl px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-10 lg:pb-12',
          )}
        >
          {/* Chats animate their own panes; other screens rise in on every route change. */}
          {chats ? (
            children
          ) : (
            <div key={pathname} className="page-enter">
              {children}
            </div>
          )}
        </main>
      </div>
      {!chatOpen && <BottomNav pathname={pathname} user={user} />}
      <ApprovalPrompt />
    </div>
  );
}
