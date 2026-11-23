import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useLiveState } from '@/lib/live';

/**
 * One cache for the whole app (TanStack Query). Screens that ask for the same data (pending
 * approvals in the tab bar, the chat list, the approval sheet) share one request, and going back
 * to a screen shows its cached data at once instead of fetching again.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  // "Window focus" on a phone is the app coming back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export type PollState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: string | null }
  | { status: 'error'; data: null; error: string };

/**
 * Cached API data under `key`. While live updates are connected there is no polling at all: live
 * events call `refresh()`; only when the live connection is down does it poll every `intervalMs`.
 * Keeps the last good data when a refresh fails and reports the error alongside it.
 */
export function usePoll<T>(key: QueryKey, fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number) {
  const live = useLiveState() === 'live';
  const client = useQueryClient();
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetcher(signal),
    refetchInterval: live ? false : intervalMs,
  });

  const keyJson = JSON.stringify(key);
  const refresh = useCallback(
    () =>
      client.invalidateQueries(
        { queryKey: JSON.parse(keyJson) as QueryKey, exact: true },
        { cancelRefetch: false },
      ),
    [client, keyJson],
  );

  const state = useMemo<PollState<T>>(() => {
    if (q.data !== undefined) {
      return { status: 'ready', data: q.data, error: q.error ? q.error.message : null };
    }
    if (q.error) return { status: 'error', data: null, error: q.error.message };
    return { status: 'loading', data: null, error: null };
  }, [q.data, q.error]);

  return { state, refresh, refreshing: q.isRefetching };
}
