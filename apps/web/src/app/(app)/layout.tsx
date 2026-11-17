'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

/** Everything in (app) requires a signed-in user. The API enforces this too; this only drives the UI. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, logout, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'unauthenticated') {
      router.replace(pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, pathname, router]);

  if (state.status === 'authenticated') {
    return (
      <AppShell
        user={state.user}
        onSignOut={async () => {
          await logout();
          router.replace('/login');
        }}
      >
        {children}
      </AppShell>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold">Can’t reach AgentDock</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">{state.message}</p>
          <Button variant="outline" className="mt-6" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}
