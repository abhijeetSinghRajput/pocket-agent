'use client';

import { DeviceListResponse } from '@pocket-agent/protocol';
import { usePathname } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { Onboarding } from '@/components/onboarding/onboarding';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';

/** "Set up later" is remembered on this browser; the Devices page still offers Add device. */
export const ONBOARDING_SKIPPED_KEY = 'pocket-agent:onboarding-skipped';

const skippedBefore = () => {
  try {
    return localStorage.getItem(ONBOARDING_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * After sign-in, on the home screen: an account without any connected PC (none paired, or only
 * revoked ones) sees the setup screen first instead of an empty app. Links straight to other pages
 * (e.g. /devices) are never intercepted.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
  const [skipped, setSkipped] = useState(skippedBefore);
  // Decided once, when the device list first arrives, so the "connected" screen stays up after the
  // new PC appears in the list (until the user continues).
  const [decision, setDecision] = useState<'onboard' | 'app' | null>(null);
  if (decision === null && state.status !== 'loading') {
    const needs =
      state.status === 'ready' &&
      !state.data.some((d) => d.status !== 'Revoked') &&
      !skipped &&
      pathname === '/';
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
        onSkip={() => {
          try {
            localStorage.setItem(ONBOARDING_SKIPPED_KEY, '1');
          } catch {
            /* private mode: skip for this visit only */
          }
          setSkipped(true);
          setDecision('app');
        }}
      />
    );
  }
  return children;
}
