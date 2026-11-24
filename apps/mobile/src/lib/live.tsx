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
import { setLiveConnected } from '@/lib/push';

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
    // Each connect() gets a number; only the latest may open a socket (a quick trip to the
    // background and back can leave an older one still waiting for its ticket).
    let generation = 0;

    const scheduleRetry = () => {
      if (disposed || !active) return;
      setState('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      retry = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      clearTimeout(retry);
      const mine = ++generation;
      let ticket: string;
      try {
        ticket = (await apiRequest('/ws/tickets', WsTicket, { method: 'POST' })).ticket;
      } catch (err) {
        if (disposed || (err instanceof ApiClientError && err.status === 401)) return; // signed out
        return scheduleRetry();
      }
      if (disposed || !active || mine !== generation) return;
      ws?.close();
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
        // A socket closed on purpose (background, replaced) doesn't schedule a reconnect.
        if (ws !== socket) return;
        ws = null;
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
        generation++; // a connect() still waiting for its ticket gives up
        const closing = ws;
        ws = null;
        closing?.close();
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
      const closing = ws;
      ws = null;
      closing?.close();
    };
  }, []);

  // Notifications that arrive in the foreground show only when the app can't show them itself.
  useEffect(() => {
    setLiveConnected(state === 'live');
    return () => setLiveConnected(false);
  }, [state]);

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

/**
 * Calls `onChange` when a matching live event arrives, and after every reconnect. A burst (Claude
 * streaming tool steps) is throttled: the first event refreshes soon, then at most once every
 * `everyMs`, with a last refresh after the burst so nothing is missed.
 */
export function useLiveRefresh(
  onChange: () => void,
  filter: (e: BackendToWeb) => boolean = () => true,
  everyMs = 1000,
) {
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
    let last = 0;
    const run = () => {
      timer = undefined;
      last = Date.now();
      cb.current();
    };
    const unsubscribe = subscribe((e) => {
      if (e && !match.current(e)) return;
      if (timer) return; // a refresh is already due and will see this event too
      // Events often come in twos (status + event): a short wait catches the pair in one fetch.
      timer = setTimeout(run, Math.max(150, last + everyMs - Date.now()));
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, everyMs]);
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
