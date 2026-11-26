import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { CommandResponse, type AttachmentRef, type CommandDto } from '@pocket-agent/protocol';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDevices } from '@/lib/data';
import { useLiveConnection } from '@/lib/live';
import { ApiClientError, apiRequest } from '@/lib/api';
import { newId } from '@/features/chat/upload';

/**
 * Messages that couldn't go yet (this phone had no connection, or the PC was offline), kept on this
 * phone (like a messenger) and sent by the app once both are online again, oldest first. The server never queues them: nothing runs on the
 * PC unless this app sends it while you can see it go. They survive closing the app; an open app
 * sends them (`sendWaiting`), from any screen.
 */
export interface WaitingMessage {
  /** The idempotency key of the next try: a repeated send can never run it twice. */
  key: string;
  sessionId: string;
  deviceId: string;
  path: string;
  body: Record<string, unknown>;
  text: string;
  files: AttachmentRef[];
  at: string;
  /** The server refused it (not because the PC was offline): it waits for you, not the PC. */
  error?: string;
}

interface Saved {
  waiting: WaitingMessage[];
  /** Commands that failed only because the PC was offline and were sent again: not shown. */
  hidden: string[];
}

const KEY = 'pocket-agent:waiting-messages';
/** Enough to hide the resent ones of any recent chat, small enough to keep on the phone. */
const HIDDEN_MAX = 200;

let state: Saved = { waiting: [], hidden: [] };
let hiddenSet = new Set<string>();
const listeners = new Set<() => void>();
let loaded: Promise<void> | null = null;

function set(next: Saved) {
  state = next;
  hiddenSet = new Set(next.hidden);
  void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  loaded ??= (async () => {
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<Saved>;
      // Anything held before the read finished stays, after what was saved.
      const seen = new Set(state.waiting.map((w) => w.key));
      state = {
        waiting: [...(saved.waiting ?? []).filter((w) => !seen.has(w.key)), ...state.waiting],
        hidden: [...(saved.hidden ?? []), ...state.hidden].slice(-HIDDEN_MAX),
      };
      hiddenSet = new Set(state.hidden);
      listeners.forEach((l) => l());
    } catch {
      /* unreadable: dropped */
    }
  })();
  return loaded;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => {
    listeners.delete(listener);
  };
}

/** Every message waiting for its PC (live). */
export function useWaiting(): readonly WaitingMessage[] {
  return useSyncExternalStore(subscribe, () => state.waiting);
}

/** Whether a command was sent again (its "PC offline" failure isn't shown). */
export function useHiddenCommands(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hiddenSet);
}

/**
 * Keeps a message until it can go. `key`: its idempotency key, kept when the server may already
 * have it (no answer came back); `replaces`: the failed command it is sent instead of.
 */
export function holdMessage(
  m: Omit<WaitingMessage, 'at' | 'key'> & { at?: string; key?: string; replaces?: string },
): void {
  const { replaces, key: kept, ...rest } = m;
  const key = kept ?? newId();
  if (state.waiting.some((w) => w.key === key)) return;
  const w: WaitingMessage = {
    ...rest,
    key,
    at: m.at ?? new Date().toISOString(),
    body: { ...m.body, idempotencyKey: key },
  };
  set({
    waiting: [...state.waiting, w],
    hidden: replaces ? [...state.hidden, replaces].slice(-HIDDEN_MAX) : state.hidden,
  });
}

/** Hides a command that failed because the PC was offline (it was sent again). */
export function hideCommand(id: string): void {
  if (!hiddenSet.has(id)) set({ ...state, hidden: [...state.hidden, id].slice(-HIDDEN_MAX) });
}

/** Takes a waiting message out (sent, or taken back to edit). */
export function dropWaiting(key: string): void {
  if (state.waiting.some((w) => w.key === key))
    set({ ...state, waiting: state.waiting.filter((w) => w.key !== key) });
}

/** A message the server refused waits for the PC again (tap to retry). */
export function retryWaiting(key: string): void {
  set({
    ...state,
    waiting: state.waiting.map((w) => (w.key === key ? { ...w, error: undefined } : w)),
  });
}

function update(key: string, change: Partial<WaitingMessage>) {
  set({ ...state, waiting: state.waiting.map((w) => (w.key === key ? { ...w, ...change } : w)) });
}

/** A command that failed only because its PC was offline (nothing reached the PC). */
export const failedOffline = (c: Pick<CommandDto, 'status' | 'error'>) =>
  c.status === 'Failed' && c.error === 'device_offline';

let flushing = false;

/**
 * Sends the waiting messages of the PCs that are online, one at a time and oldest first (a chat's
 * messages arrive in the order they were written). One still refused for being offline (the PC
 * dropped again) keeps waiting under a new key; any other refusal stays in its chat to retry.
 */
export async function sendWaiting(online: ReadonlySet<string>, client: QueryClient): Promise<void> {
  await load();
  if (flushing) return;
  flushing = true;
  try {
    // A chat whose message didn't go is skipped this round: later ones wait behind it.
    const stuck = new Set<string>();
    for (const w of [...state.waiting]) {
      if (w.error || !online.has(w.deviceId) || stuck.has(w.sessionId)) {
        stuck.add(w.sessionId);
        continue;
      }
      let command: CommandDto;
      try {
        ({ command } = await apiRequest(w.path, CommandResponse, { method: 'POST', body: w.body }));
      } catch (err) {
        stuck.add(w.sessionId);
        // No connection: tried again later. The server said no: it waits for you.
        if (err instanceof ApiClientError && err.status >= 400 && err.status < 500)
          update(w.key, { error: err.message });
        continue;
      }
      if (failedOffline(command)) {
        stuck.add(w.sessionId);
        const key = newId();
        set({
          waiting: state.waiting.map((x) =>
            x.key === w.key ? { ...x, key, body: { ...x.body, idempotencyKey: key } } : x,
          ),
          hidden: [...state.hidden, command.id].slice(-HIDDEN_MAX),
        });
        continue;
      }
      // The chat lists it from the server before it leaves here: it never blinks out.
      await client.invalidateQueries({ queryKey: ['commands', w.sessionId] }).catch(() => undefined);
      dropWaiting(w.key);
    }
  } finally {
    flushing = false;
  }
}

/** How often to try again while a PC is online but a message didn't go (no connection). */
const RETRY_MS = 30_000;

/**
 * Sends waiting messages whenever they can go: when the phone's connection or their PC comes back,
 * when one is written, and again every 30 s while one is left. Mounted once, behind sign-in.
 */
export function useSendWhenOnline(): void {
  const devices = useDevices().state.data;
  const waiting = useWaiting();
  const client = useQueryClient();
  // Live updates reconnecting means the connection is back: try at once instead of in 30 s.
  const live = useLiveConnection() === 'live';
  const online = (devices ?? [])
    .filter((d) => d.status === 'Online')
    .map((d) => d.id)
    .sort()
    .join(',');
  const due = waiting.some((w) => !w.error && online.split(',').includes(w.deviceId));
  useEffect(() => {
    if (!due) return;
    const go = () => void sendWaiting(new Set(online.split(',')), client);
    go();
    const t = setInterval(go, RETRY_MS);
    return () => clearInterval(t);
  }, [due, online, waiting, client, live]);
}

/** Sends waiting messages from any screen (see `useSendWhenOnline`). */
export function SendWhenOnline(): null {
  useSendWhenOnline();
  return null;
}

/** The waiting messages of one chat. */
export function useChatWaiting(sessionId: string): WaitingMessage[] {
  const all = useWaiting();
  return useMemo(() => all.filter((w) => w.sessionId === sessionId), [all, sessionId]);
}
