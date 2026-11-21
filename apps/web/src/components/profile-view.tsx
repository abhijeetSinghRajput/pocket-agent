'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';

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
