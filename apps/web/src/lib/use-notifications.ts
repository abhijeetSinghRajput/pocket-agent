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
    (e) => e.eventType === 'notification.created',
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

export async function markRead(ids?: string[]) {
  await apiRequest('/notifications/read', null, { method: 'POST', body: ids ? { ids } : {} });
  window.dispatchEvent(new Event(READ_EVENT));
}
