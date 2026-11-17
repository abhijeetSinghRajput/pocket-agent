'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PollState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: string | null }
  | { status: 'error'; data: null; error: string };

/**
 * Fetches immediately, then every `intervalMs` while the tab is visible. Keeps the last good data
 * when a refresh fails (and reports the error alongside it), so a blip doesn't blank the page.
 * Live WebSocket updates for the browser replace polling in M3.
 */
export function usePoll<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number) {
  const [state, setState] = useState<PollState<T>>({ status: 'loading', data: null, error: null });
  const fetcherRef = useRef(fetcher);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const c = new AbortController();
    inflight.current = c;
    try {
      const data = await fetcherRef.current(c.signal);
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (c.signal.aborted) return;
      const message = (err as Error).message;
      setState((prev) =>
        prev.status === 'ready'
          ? { ...prev, error: message }
          : { status: 'error', data: null, error: message },
      );
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, intervalMs);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      inflight.current?.abort();
    };
  }, [refresh, intervalMs]);

  return { state, refresh };
}
