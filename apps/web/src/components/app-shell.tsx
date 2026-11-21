'use client';

import type { UserDto } from '@pocket-agent/protocol';
import { Bell } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ApprovalPrompt } from '@/components/approvals/approval-prompt';
import { PROFILE_ROUTES, ProfileLink } from '@/components/user-avatar';
import { ThemeToggle } from '@/components/theme';
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
      <Bell className="size-4" aria-hidden />
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
      href="/"
      className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Image src="/icons/logo-64.png" alt="" width={28} height={28} priority className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Pocket Agent</span>
    </Link>
  );
}

function Sidebar({ pathname, user }: { pathname: string; user: UserDto }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <div className="flex items-center">
          <LiveDot />
          <NotificationBell />
        </div>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              <Icon className={cn('size-[18px]', active ? 'text-primary' : 'text-foreground')} aria-hidden />
              {label}
              {href === '/approvals' && <PendingBadge />}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between border-t p-3">
        <ThemeToggle />
        <ProfileLink
          user={user}
          active={PROFILE_ROUTES.some((h) => isActive(pathname, h))}
          className="size-10"
        />
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
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
}

function BottomNav({ pathname, user }: { pathname: string; user: UserDto }) {
  const itemClass = (active: boolean) =>
    cn(
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors focus-visible:bg-accent active:bg-accent/60',
      active && 'text-primary',
    );
  const profileActive = PROFILE_ROUTES.some((h) => isActive(pathname, h));

  return (
    <nav
      aria-label="Main"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={itemClass(active)}
          >
            <span className="relative">
              <Icon className={cn('size-5', active ? 'text-primary' : 'text-foreground')} aria-hidden />
              {href === '/approvals' && <PendingDot />}
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
