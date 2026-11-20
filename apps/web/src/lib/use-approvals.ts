'use client';

import { ApprovalListResponse } from '@agentdock/protocol';
import { useCallback } from 'react';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';

/** Pending (or recent) approvals, refreshed live. Approval state always comes from the API. */
export function useApprovals(scope: 'pending' | 'all' = 'pending') {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/approvals?status=${scope}`, ApprovalListResponse, { signal }).then((r) => r.approvals),
    [scope],
  );
  const poll = usePoll(fetcher, 30_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.eventType === 'approval.created' || e.eventType === 'approval.updated',
  );
  return poll;
}
