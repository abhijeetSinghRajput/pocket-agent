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
import { AppState } from 'react-native';
import { z } from 'zod';
import { ApiClientError, apiRequest, WS_URL } from '@/lib/api';

const WsTicket = z.object({ ticket: z.string().min(1) });

/** `null` = resync: we (re)connected and may have missed events, so refresh everything. */
type Listener = (event: BackendToWeb | null) => void;
export type LiveState = 'connecting' | 'live' | 'reconnecting';

interface LiveApi {
  state: LiveState;
  subscribe(listener: Listener): () => void;
}

const LiveContext = createContext<LiveApi | null>(null);

/**
 * One WebSocket to `/ws/client` while the app is in the foreground (opened with a one-time
 * ticket). Server → app only: events say *what changed*; screens re-fetch what they show. Screens
 * also poll slowly as a fallback, so a dropped socket never leaves the UI stale for long.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>('connecting');
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let active = AppState.currentState === 'active';

    const scheduleRetry = () => {
      if (disposed || !active) return;
      setState('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      retry = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      clearTimeout(retry);
      let ticket: string;
      try {
        ticket = (await apiRequest('/ws/tickets', WsTicket, { method: 'POST' })).ticket;
      } catch (err) {
        if (disposed || (err instanceof ApiClientError && err.status === 401)) return; // signed out
        return scheduleRetry();
      }
      if (disposed || !active) return;
      const socket = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      ws = socket;
      socket.onopen = () => {
        attempt = 0;
        setState('live');
        // Anything may have changed while we were away.
        listeners.current.forEach((l) => l(null));
      };
      socket.onmessage = (m) => {
        try {
          const parsed = BackendToWeb.safeParse(JSON.parse(String(m.data)));
          if (parsed.success) listeners.current.forEach((l) => l(parsed.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = (e) => {
        if (ws === socket) ws = null;
        if (disposed || e.code === 4401) return; // signed out: the auth layer takes over
        scheduleRetry();
      };
    };

    // Phones suspend sockets in the background: close on the way out, reconnect on the way back.
    const sub = AppState.addEventListener('change', (next) => {
      const now = next === 'active';
      if (now === active) return;
      active = now;
      if (!active) {
        clearTimeout(retry);
        ws?.close();
        ws = null;
      } else {
        attempt = 0;
        void connect();
      }
    });

    if (active) void connect();
    return () => {
      disposed = true;
      sub.remove();
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

/** Calls `onChange` (debounced) when a matching live event arrives, and after every reconnect. */
export function useLiveRefresh(onChange: () => void, filter: (e: BackendToWeb) => boolean = () => true) {
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
