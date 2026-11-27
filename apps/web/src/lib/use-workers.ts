'use client';

import { DeviceListResponse, SubagentDetailResponse, WorkerListResponse } from '@pocket-agent/protocol';
import { useCallback } from 'react';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';

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
  );
  return poll;
}

/**
 * One sub-agent's work, read live from its PC, with the chat's whole agent list (what each running
 * agent is doing now). Its tool calls report through the chat, so the chat's events refresh it.
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
  );
  return poll;
}

/** Your PCs (shares its cache with the Devices page), refreshed when one goes on or offline. */
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
