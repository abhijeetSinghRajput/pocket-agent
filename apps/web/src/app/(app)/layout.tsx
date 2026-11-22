'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { OnboardingGate } from '@/components/onboarding/onboarding-gate';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { LiveProvider } from '@/lib/live';
import { QueryProvider } from '@/lib/query';

/** Everything in (app) requires a signed-in user. The API enforces this too; this only drives the UI. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Signed out from inside the app: plain sign-in page. Arriving signed out: come back here afterwards.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (state.status === 'authenticated') wasSignedIn.current = true;
    if (state.status === 'unauthenticated') {
      router.replace(
        pathname === '/' || wasSignedIn.current ? '/login' : `/login?next=${encodeURIComponent(pathname)}`,
      );
    }
  }, [state.status, pathname, router]);

  if (state.status === 'authenticated') {
    return (
      <QueryProvider>
        <LiveProvider>
          <OnboardingGate>
            <AppShell user={state.user}>{children}</AppShell>
          </OnboardingGate>
        </LiveProvider>
      </QueryProvider>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold">Can’t reach Pocket Agent</h1>
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
