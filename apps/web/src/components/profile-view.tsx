'use client';

import { Bell, ChevronRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useNotifications } from '@/lib/use-notifications';

/** Who is signed in. */
export function ProfileHeader() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  const { user } = state;
  return (
    <section
      className="flex items-center gap-3.5 rounded-xl bg-card px-4 py-3.5"
      data-testid="profile-header"
    >
      <UserAvatar user={user} className="size-14 text-lg" />
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{user.name}</h2>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{user.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">Member since {formatDate(user.createdAt)}</p>
      </div>
    </section>
  );
}

/** Row linking to the notification inbox, with the unread count. */
export function InboxLink() {
  const n = useNotifications(1).state.data?.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="flex items-center gap-3 rounded-xl bg-card px-4 py-3.5 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Bell className="size-5 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-sm font-medium">Notifications</span>
      {n > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
          {n > 99 ? '99+' : n}
          <span className="sr-only"> unread</span>
        </span>
      )}
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function SignOutButton() {
  const { logout } = useAuth();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      className="h-11 w-full border-0 bg-card text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
      onClick={async () => {
        await logout();
        router.replace('/login');
      }}
    >
      <LogOut aria-hidden /> Sign out
    </Button>
  );
}
