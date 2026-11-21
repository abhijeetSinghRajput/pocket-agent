'use client';

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useLiveState } from '@/lib/live';

export type PollState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: string | null }
  | { status: 'error'; data: null; error: string };

/**
 * Cached API data (TanStack Query) under `key`. Every component using the same key shares one
 * request and one cache entry. While live updates are connected there is no polling at all: live
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

  // Several components refreshing the same key at once share the request in flight.
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

  return { state, refresh };
}
