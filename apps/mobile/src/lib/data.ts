import {
  ApprovalListResponse,
  CommandListResponse,
  DeviceListResponse,
  EventPage,
  NotificationPage,
  SessionListResponse,
  SessionResponse,
  SubagentDetailResponse,
  WorkerListResponse,
  type AgentEventDto,
  type BackendToWeb,
} from '@pocket-agent/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { foreground, useLiveRefresh, useLiveState } from '@/lib/live';
import { usePoll } from '@/lib/query';

/**
 * What the screens show, straight from the API (the same endpoints and cache keys everywhere, so
 * two screens asking for the same thing share one request). Live events say what to re-fetch.
 */

/** The account's PCs. */
export function useDevices() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const poll = usePoll(['devices'], fetcher, 30_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.eventType === 'device.status.changed',
  );
  return poll;
}

/**
 * What changes a chat's row or header: its status, the PC's, and session-level events (started,
 * updated task, ended). A plain tool step or output doesn't, so streaming doesn't refetch lists.
 */
const sessionChange = (e: BackendToWeb) =>
  e.eventType === 'agent.status.changed' ||
  e.eventType === 'device.status.changed' ||
  (e.eventType === 'agent.event.created' && e.payload.eventType.startsWith('agent.session.'));

/** Chats: the active ones, or all of them. */
export function useSessions(scope: 'active' | 'all') {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions?scope=${scope}`, SessionListResponse, { signal }).then((r) => r.sessions),
    [scope],
  );
  const poll = usePoll(['sessions', scope], fetcher, 30_000);
  // The list's times only show minutes: a refresh every few seconds while Claude works is plenty.
  useLiveRefresh(() => void poll.refresh(), sessionChange, 3000);
  return poll;
}

/** One chat's session. */
export function useSession(id: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${id}`, SessionResponse, { signal }).then((r) => r.session),
    [id],
  );
  // The open chat's header (working… / waiting for you): checked often if live updates are down.
  const poll = usePoll(['session', id], fetcher, 5_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => (e.sessionId === id || e.eventType === 'device.status.changed') && sessionChange(e),
  );
  return poll;
}

/** Messages sent to a chat from Pocket Agent, with their delivery status. */
export function useCommands(sessionId: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${sessionId}/commands`, CommandListResponse, { signal }).then((r) => r.commands),
    [sessionId],
  );
  const poll = usePoll(['commands', sessionId], fetcher, 5_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.eventType === 'command.status.changed' && e.sessionId === sessionId,
  );
  return poll;
}

/** Pending (or recent) approvals. Approval state always comes from the API. */
export function useApprovals(scope: 'pending' | 'all' = 'pending') {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/approvals?status=${scope}`, ApprovalListResponse, { signal }).then((r) => r.approvals),
    [scope],
  );
  const poll = usePoll(['approvals', scope], fetcher, 30_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.eventType === 'approval.created' || e.eventType === 'approval.updated',
  );
  return poll;
}

/** Latest notifications + unread count. History in the API is the source of truth. */
export function useNotifications(limit = 30) {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest(`/notifications?limit=${limit}`, NotificationPage, { signal }),
    [limit],
  );
  const poll = usePoll(['notifications', limit], fetcher, 60_000);
  useLiveRefresh(
    () => void poll.refresh(),
    // An answered request marks its notification read on the server.
    (e) => e.eventType === 'notification.created' || e.eventType === 'approval.updated',
  );
  return poll;
}

/** Marks notifications read: the given ones, the ones that open `link`, or (neither) all. */
export async function markRead(what: { ids?: string[]; link?: string } = {}): Promise<void> {
  await apiRequest('/notifications/read', null, { method: 'POST', body: what });
}

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
 * loading older pages continues until one brings an earlier message (or the start is reached).
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
        // Events never change once stored: keep the ones already here, so an unchanged head page
        // leaves the conversation as it is (nothing is rebuilt or redrawn).
        const known = new Map(prev.map((e) => [e.id, e]));
        const head = page.events.map((e) => known.get(e.id) ?? e);
        const fresh = new Set(head.map((e) => e.id));
        const older = prev.filter((e) => !fresh.has(e.id));
        // Without older pages loaded, the head page is the whole list.
        const next = loadedOlder.current ? [...head, ...older] : head;
        return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next;
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
    return () => clearTimeout(first);
  }, [refreshHead]);
  // While live updates are connected they say when to refresh; otherwise poll.
  const live = useLiveState() === 'live';
  // Without them, the open chat checks often: a reply never waits long to show up.
  useEffect(() => {
    if (live) return;
    const poll = setInterval(() => foreground() && void refreshHead(), 5_000);
    return () => clearInterval(poll);
  }, [live, refreshHead]);

  // The oldest event loaded so far: anything older isn't on screen yet.
  const oldestAt = events.length ? events[events.length - 1]!.createdAt : null;
  return { events, status, error, hasMore: !!cursor, loadMore, loadingMore, refreshHead, oldestAt };
}

/** Background workers (sub-agents, workflows) running in your chats, and the ones that finished today. */
export function useWorkers() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/workers', WorkerListResponse, { signal }).then((r) => r.workers),
    [],
  );
  const poll = usePoll(['workers'], fetcher, 30_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) =>
      e.eventType === 'agent.event.created' &&
      /^agent\.(tool\.|worker\.|session\.ended|output)/.test(e.payload.eventType),
    3000,
  );
  return poll;
}

/**
 * One sub-agent's work, read live from its PC: its prompt, tool calls and transcript, with the
 * chat's whole agent map. Its tool calls report through the chat, so the chat's events refresh it.
 */
export function useSubagent(sessionId: string, toolUseId: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${sessionId}/agents/${encodeURIComponent(toolUseId)}`, SubagentDetailResponse, {
        signal,
      }),
    [sessionId, toolUseId],
  );
  const poll = usePoll(['subagent', sessionId, toolUseId], fetcher, 15_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.sessionId === sessionId && e.eventType === 'agent.event.created',
    4000,
  );
  return poll;
}
