'use client';

import { NotificationPage } from '@pocket-agent/protocol';
import { useCallback, useEffect } from 'react';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';

/** Latest notifications + unread count, refreshed live. History in the API is the source of truth. */
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
  // Read state changed in this tab (e.g. the bell after "Mark all read").
  const { refresh } = poll;
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener(READ_EVENT, on);
    return () => window.removeEventListener(READ_EVENT, on);
  }, [refresh]);
  return poll;
}

const READ_EVENT = 'pocket-agent:notifications-read';

/**
 * While a chat is open, its notifications ("Claude finished", "Claude is asking you", …) count as
 * seen: they are marked read when it opens, when the app comes back to it, and as new ones arrive.
 */
export function useMarkChatRead(sessionId: string) {
  // As the API writes a chat's link (see webPath in lib/nav.ts).
  const link = `/agents/${sessionId}`;
  const mark = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    void apiRequest('/notifications/read', null, { method: 'POST', body: { link } })
      .then(() => window.dispatchEvent(new Event(READ_EVENT)))
      .catch(() => undefined);
  }, [link]);
  useEffect(() => {
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [mark]);
  useLiveRefresh(mark, (e) => e.eventType === 'notification.created');
}

export async function markRead(ids?: string[]) {
  await apiRequest('/notifications/read', null, { method: 'POST', body: ids ? { ids } : {} });
  window.dispatchEvent(new Event(READ_EVENT));
}
