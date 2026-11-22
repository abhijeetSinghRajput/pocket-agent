'use client';

import { DeviceListResponse } from '@pocket-agent/protocol';
import { useCallback, useState, type ReactNode } from 'react';
import { Onboarding } from '@/components/onboarding/onboarding';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';

/**
 * Nothing in the app works without a PC, so an account with no connected PC (none paired, or only
 * revoked ones) sees the setup screen on every page, and can't skip it. Once a PC is paired the app
 * opens as usual (an offline PC still counts: it is set up, just not running right now).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  // Same cache key as the Devices page: one request, shared.
  const { state, refresh } = usePoll(['devices'], fetcher, 30_000);
  useLiveRefresh(
    () => void refresh(),
    (e) => e.eventType === 'device.status.changed',
  );
  // Decided once, when the device list first arrives, so the "connected" screen stays up after the
  // new PC appears in the list (until the user continues).
  const [decision, setDecision] = useState<'onboard' | 'app' | null>(null);
  if (decision === null && state.status !== 'loading') {
    // If the list can't be loaded, don't lock the user out: the app shows its own errors.
    const needs = state.status === 'ready' && !state.data.some((d) => d.status !== 'Revoked');
    setDecision(needs ? 'onboard' : 'app');
  }

  if (decision === null) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
        <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }
  if (decision === 'onboard') {
    return (
      <Onboarding
        knownDeviceIds={(state.data ?? []).map((d) => d.id)}
        onDone={() => {
          void refresh();
          setDecision('app');
        }}
      />
    );
  }
  return children;
}
