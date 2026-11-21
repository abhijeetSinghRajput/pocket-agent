'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * One cache for the whole signed-in app (TanStack Query). Components that ask for the same data
 * (e.g. pending approvals in the nav, the chat list and the approval prompt) share one request,
 * and going back to a screen shows its cached data at once instead of fetching again.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live events invalidate what changed; data otherwise stays fresh for a while.
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
