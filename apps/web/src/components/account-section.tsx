'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';

export function AccountSection() {
  const { state, logout } = useAuth();
  const router = useRouter();
  if (state.status !== 'authenticated') return null;
  const { user } = state;
  return (
    <section className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Account</h2>
        <p className="mt-1 truncate text-sm">{user.name}</p>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">Member since {formatDate(user.createdAt)}</p>
      </div>
      <Button
        variant="outline"
        className="self-start sm:self-center"
        onClick={async () => {
          await logout();
          router.replace('/login');
        }}
      >
        <LogOut aria-hidden /> Sign out
      </Button>
    </section>
  );
}
