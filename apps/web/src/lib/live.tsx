'use client';

import { BackendToWeb } from '@pocket-agent/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import { apiBaseUrl, ApiClientError, apiRequest } from '@/lib/api';

const WsTicket = z.object({ ticket: z.string().min(1) });

/**
 * Live-updates endpoint. NEXT_PUBLIC_WS_URL is set when the API is reached through a proxy path
 * (e.g. NEXT_PUBLIC_API_URL=/api on Vercel), since WebSockets go straight to the API host.
 */
export function liveUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const base = apiBaseUrl();
  if (!/^https?:\/\//.test(base))
    throw new Error('Set NEXT_PUBLIC_WS_URL when NEXT_PUBLIC_API_URL is a relative path');
  return base.replace(/^http/, 'ws') + '/ws/client';
}

/** `null` = resync: we (re)connected and may have missed events, so refresh everything. */
type Listener = (event: BackendToWeb | null) => void;
export type LiveState = 'connecting' | 'live' | 'reconnecting';

interface LiveApi {
  state: LiveState;
  subscribe(listener: Listener): () => void;
}

const LiveContext = createContext<LiveApi | null>(null);

/**
 * One WebSocket per tab to `/ws/client` (authenticated by the session cookie). Server → browser
 * only: events say *what changed*; views re-fetch the data they show. Pages also poll slowly as a
 * fallback, so a dropped socket never leaves the UI stale for long.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>('connecting');
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const url = liveUrl();
    const scheduleRetry = () => {
      setState('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      retry = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      // A one-time ticket works even when the API is on another site than the dashboard
      // (its cookie isn't sent there); see /ws/tickets in the API.
      let ticket: string;
      try {
        ticket = (await apiRequest('/ws/tickets', WsTicket, { method: 'POST' })).ticket;
      } catch (err) {
        if (disposed || (err instanceof ApiClientError && err.status === 401)) return; // signed out
        return scheduleRetry();
      }
      if (disposed) return;
      ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
      ws.onopen = () => {
        attempt = 0;
        setState('live');
        // Anything may have changed while we were away.
        listeners.current.forEach((l) => l(null));
      };
      ws.onmessage = (m) => {
        try {
          const parsed = BackendToWeb.safeParse(JSON.parse(String(m.data)));
          if (parsed.success) listeners.current.forEach((l) => l(parsed.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (e) => {
        if (disposed || e.code === 4401) return; // signed out: the auth layer redirects
        scheduleRetry();
      };
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const api = useMemo<LiveApi>(() => ({ state, subscribe }), [state, subscribe]);

  return <LiveContext.Provider value={api}>{children}</LiveContext.Provider>;
}

export function useLiveState(): LiveState {
  return useContext(LiveContext)?.state ?? 'connecting';
}

/** Calls `onChange` (debounced) when a live event matching `filter` arrives. */
export function useLiveRefresh(onChange: () => void, filter: (e: BackendToWeb) => boolean = () => true) {
  // Depend on the stable `subscribe`, not the context object: the object changes with the
  // connection state, and re-subscribing then would drop a refresh that is still pending.
  const subscribe = useContext(LiveContext)?.subscribe;
  const cb = useRef(onChange);
  const match = useRef(filter);
  useEffect(() => {
    cb.current = onChange;
    match.current = filter;
  });
  useEffect(() => {
    if (!subscribe) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe((e) => {
      if (e && !match.current(e)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe]);
}

/** Calls `onEvent` with each live event as it arrives (no batching, unlike useLiveRefresh). */
export function useLiveEvents(onEvent: (e: BackendToWeb) => void) {
  const subscribe = useContext(LiveContext)?.subscribe;
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  });
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((e) => {
      if (e) cb.current(e);
    });
  }, [subscribe]);
}
