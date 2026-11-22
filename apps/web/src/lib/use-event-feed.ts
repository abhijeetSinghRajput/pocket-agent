'use client';

import { EventPage, type AgentEventDto } from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';

/** The API's largest page. */
const PAGE = 100;
/** "Load older" keeps going (up to this many pages) until it reaches an earlier message. */
const MAX_PAGES_PER_LOAD = 10;

/** A message in the conversation (yours or Claude's), as opposed to a tool step or status change. */
const isMessage = (e: AgentEventDto) =>
  e.eventType === 'agent.output' && typeof e.payload['text'] === 'string' && !!e.payload['text'];

/**
 * Newest-first event feed with "load older" pagination. `refreshHead` re-fetches the newest page
 * and merges it in (used on live updates), keeping already-loaded older pages.
 *
 * A single reply can be dozens of tool steps, so a page of events may hold no message at all:
 * loading older pages continues until one brings an earlier message (or the start is reached),
 * otherwise "Load older messages" would seem to do nothing.
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
      const page = await apiRequest(`${path}?limit=${PAGE}`, EventPage);
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
      let next: string | null = cursor;
      const got: AgentEventDto[] = [];
      for (let i = 0; next && i < MAX_PAGES_PER_LOAD; i++) {
        const page: EventPage = await apiRequest(`${path}?limit=${PAGE}&before=${next}`, EventPage);
        got.push(...page.events);
        next = page.nextCursor;
        if (page.events.some(isMessage)) break;
      }
      loadedOlder.current = true;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...got.filter((e) => !seen.has(e.id))];
      });
      setCursor(next);
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

  // The oldest event loaded so far: anything older isn't on screen yet (see the chat's commands).
  const oldestAt = events.length ? events[events.length - 1]!.createdAt : null;
  return { events, status, error, hasMore: !!cursor, loadMore, loadingMore, refreshHead, oldestAt };
}
