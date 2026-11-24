import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Onboarding } from '@/features/onboarding/onboarding';
import { useDevices } from '@/lib/data';
import { enter, exit } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { Spinner } from '@/ui/core';

/**
 * Nothing in the app works without a PC, so an account with no connected PC (none paired, or only
 * revoked ones) sees the setup screen on every route, and can't skip it. Once a PC is paired the app
 * opens as usual (an offline PC still counts: it is set up, just not running right now). Removing
 * the last PC while the app is open brings the setup screen back.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  // Same cache key as the Devices tab: one request, shared.
  const { state, refresh } = useDevices();
  // Decided once, when the device list first arrives, so the "connected" screen stays up after the
  // new PC appears in the list (until the user continues).
  const [decision, setDecision] = useState<'onboard' | 'app' | null>(null);
  // If the list can't be loaded, don't lock the user out: the app shows its own errors.
  const noPc = state.status === 'ready' && !state.data.some((d) => d.status !== 'Revoked');
  if (decision === null && state.status !== 'loading') setDecision(noPc ? 'onboard' : 'app');
  // The last PC was revoked while the app was open: back to setup.
  if (decision === 'app' && noPc) setDecision('onboard');

  if (decision === null) {
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityState={{ busy: true }}
        style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}
      >
        <Spinner />
      </View>
    );
  }
  if (decision === 'onboard') {
    return (
      <Animated.View key="onboarding" entering={enter.fade} exiting={exit.fade} style={{ flex: 1 }}>
        <Onboarding
          knownDeviceIds={(state.data ?? []).map((d) => d.id)}
          onDone={async () => {
            // The new PC must be in the shared list first, or the app would bounce back here.
            await refresh();
            setDecision('app');
          }}
        />
      </Animated.View>
    );
  }
  return (
    <Animated.View key="app" entering={enter.fade} style={{ flex: 1 }}>
      {children}
    </Animated.View>
  );
}
