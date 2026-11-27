'use client';

import type { UserDto } from '@pocket-agent/protocol';
import { Bell, type LucideProps } from 'lucide-react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type ComponentType, type ReactNode } from 'react';
import { ApprovalPrompt } from '@/components/approvals/approval-prompt';
import { PROFILE_ROUTES, ProfileLink, ProfileRow } from '@/components/user-avatar';
import { ThemeToggle, useMounted, useSmoothTheme } from '@/components/theme';
import { SoundToggle } from '@/components/ui/sound';
import { ThemeIcon } from '@/components/ui/theme-icon';
import { followStyle, useFollow } from '@/components/ui/segmented';
import { useNotifications } from '@/lib/use-notifications';
import { isActive, isChatsRoute, NAV_ITEMS, openChatId } from '@/lib/nav';
import { cn } from '@/lib/utils';

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
      <Bell className="size-[18px]" aria-hidden />
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
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      data-testid="theme-toggle"
      className="mt-auto flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {mounted ? (
        <ThemeIcon dark={!dark} size={18} className="text-foreground" />
      ) : (
        <span className="size-[18px]" />
      )}
      {dark ? 'Light theme' : 'Dark theme'}
      <kbd className="ml-auto rounded border px-1.5 font-mono text-[11px] text-muted-foreground">D</kbd>
    </button>
  );
}

function Sidebar({ pathname, user }: { pathname: string; user: UserDto }) {
  const nav = useRef<HTMLElement>(null);
  const { rect, last, moving } = useFollow(nav, '[aria-current="page"]', pathname);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <div className="flex items-center">
          <NotificationBell />
        </div>
      </div>
      <nav ref={nav} aria-label="Main" className="relative flex flex-1 flex-col gap-0.5 px-3 py-2">
        {/* The selection slides from one item to the next. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-md bg-accent"
          style={followStyle(rect, moving, last)}
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
              <NavIcon icon={Icon} active={active} className="size-[18px]" />
              {label}
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
        <SoundToggle className="size-9 rounded-lg" />
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The bell as a bottom-nav item (phones). */
const BELL = { href: '/notifications', label: 'Alerts', icon: Bell } as const;

/**
 * A nav icon as the app draws it: the outline in one tone and the inside in a soft wash of the
 * same tone, grey when idle and the accent (a touch bolder and bigger) when open.
 */
function NavIcon({
  icon: Icon,
  active,
  className,
}: {
  icon: ComponentType<LucideProps>;
  active: boolean;
  className?: string;
}) {
  return (
    <Icon
      aria-hidden
      fill="currentColor"
      fillOpacity={active ? 0.24 : 0.14}
      strokeWidth={active ? 2.3 : 2}
      className={cn(
        'transition-transform duration-200 ease-(--ease-out)',
        active ? 'scale-106 text-primary' : 'text-muted-foreground',
        className,
      )}
    />
  );
}

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
      'flex min-h-16 flex-1 flex-col items-center gap-1 pt-2 text-[11px] leading-[14px] text-muted-foreground outline-none focus-visible:bg-accent',
      active ? 'font-semibold text-primary' : 'font-medium',
    );
  const profileActive = PROFILE_ROUTES.some((h) => isActive(pathname, h));
  const unread = useNotifications(1).state.data?.unread ?? 0;
  const nav = useRef<HTMLElement>(null);
  const { rect, last, moving } = useFollow(nav, '[aria-current="page"]', pathname);
  const at = rect ?? last;
  const PILL = 58;

  return (
    <nav
      ref={nav}
      aria-label="Main"
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/* As in the app: a soft accent pill behind the open section's icon, sliding to it. The
          avatar has its own ring instead, so the pill fades out on Profile. */}
      <span
        aria-hidden
        data-testid="nav-indicator"
        className="pointer-events-none absolute top-2 left-0 h-8 rounded-full bg-primary/14"
        style={{
          width: PILL,
          opacity: rect && !profileActive ? 1 : 0,
          transform: `translateX(${at ? at.x + at.w / 2 - PILL / 2 : 0}px)`,
          transition: moving ? 'transform 320ms var(--ease-move), opacity 160ms' : 'opacity 160ms',
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
            <span className="relative grid h-8 place-items-center">
              <NavIcon icon={Icon} active={active} className="size-[21px]" />
              {href === BELL.href && <UnreadDot />}
            </span>
            {label}
          </Link>
        );
      })}
      {/* Account, bottom right: just the picture. Settings live inside it. */}
      <div className="flex min-h-16 flex-1 items-start justify-center pt-2">
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
