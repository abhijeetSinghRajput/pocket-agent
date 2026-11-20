'use client';

import { EventPage, type AgentEventDto } from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';

/**
 * Newest-first event feed with "load older" pagination. `refreshHead` re-fetches the newest page
 * and merges it in (used on live updates), keeping already-loaded older pages.
 */
export function useEventFeed(path: string) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedOlder = useRef(false);

  const refreshHead = useCallback(async () => {
    try {
      const page = await apiRequest(`${path}?limit=50`, EventPage);
      setEvents((prev) => {
        const fresh = new Map(page.events.map((e) => [e.id, e]));
        const older = prev.filter((e) => !fresh.has(e.id));
        // Without older pages loaded, the head page is the whole list.
        return loadedOlder.current ? [...page.events, ...older] : page.events;
      });
      if (!loadedOlder.current) setCursor(page.nextCursor);
      setStatus('ready');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, [path]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiRequest(`${path}?limit=50&before=${cursor}`, EventPage);
      loadedOlder.current = true;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.events.filter((e) => !seen.has(e.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, path]);

  useEffect(() => {
    const first = setTimeout(() => void refreshHead(), 0);
    const poll = setInterval(() => document.visibilityState === 'visible' && void refreshHead(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [refreshHead]);

  return { events, status, error, hasMore: !!cursor, loadMore, loadingMore, refreshHead };
}
