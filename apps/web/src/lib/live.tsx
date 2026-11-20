'use client';

import { BackendToWeb } from '@agentdock/protocol';
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
import { apiBaseUrl } from '@/lib/api';

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
    const url = apiBaseUrl().replace(/^http/, 'ws') + '/ws/client';

    const connect = () => {
      ws = new WebSocket(url);
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
        setState('reconnecting');
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
        retry = setTimeout(connect, delay);
      };
    };
    connect();
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
  const ctx = useContext(LiveContext);
  const cb = useRef(onChange);
  const match = useRef(filter);
  useEffect(() => {
    cb.current = onChange;
    match.current = filter;
  });
  useEffect(() => {
    if (!ctx) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = ctx.subscribe((e) => {
      if (e && !match.current(e)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [ctx]);
}
