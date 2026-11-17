'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';
import { Logo } from '@/components/app-shell';
import { ThemeToggle } from '@/components/theme';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/redirect';

function RedirectIfSignedIn() {
  const { state } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (state.status === 'authenticated') router.replace(safeNextPath(params.get('next')));
  }, [state.status, params, router]);
  return null;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-12 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
