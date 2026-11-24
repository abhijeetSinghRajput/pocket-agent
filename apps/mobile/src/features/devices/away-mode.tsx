import { type DeviceDto } from '@pocket-agent/protocol';
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { apiRequest } from '@/lib/api';
import { useDevices } from '@/lib/data';
import { enter, exit, layout } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { T, buzz } from '@/ui/core';
import { Toggle } from '@/ui/form';

/**
 * Away mode: permission requests of sessions the user started on this PC come to Pocket Agent.
 * Only possible when the PC itself allows remote approval.
 */
export function AwayMode({ device }: { device: DeviceDto }) {
  const { c } = useTheme();
  const devices = useDevices();
  const [on, setOn] = useState(device.awayMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!device.remoteApprovalEnabled) {
    return (
      <T variant="small" tone="muted" testID="remote-approval-off">
        Remote approval is off. On this PC, run{' '}
        <T
          variant="mono"
          style={{ fontSize: 12.5, backgroundColor: c.muted, color: c.foreground, borderRadius: 4 }}
        >
          {' pocket-agent approvals enable '}
        </T>
      </T>
    );
  }
  return (
    <Animated.View layout={layout} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T variant="smallMedium">Away mode</T>
        <Toggle
          value={on}
          label="Away mode"
          disabled={busy}
          testID="away-switch"
          onChange={async (next) => {
            setBusy(true);
            setError(null);
            try {
              const r = (await apiRequest(`/devices/${device.id}/away`, null, {
                method: 'POST',
                body: { awayMode: next },
              })) as { device: DeviceDto };
              setOn(r.device.awayMode);
              // Devices and Profile both show it: keep the shared list in step.
              void devices.refresh();
            } catch (err) {
              setError((err as Error).message);
              buzz(false);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <Animated.View key={String(on)} entering={enter.fade} exiting={exit.fade}>
        <T variant="caption" tone="muted">
          {on
            ? 'Permission requests come here first. After 5 minutes the PC asks.'
            : 'Claude Code asks on the PC.'}
        </T>
      </Animated.View>
      {error && (
        <Animated.View entering={enter.fade} exiting={exit.fade} accessibilityRole="alert">
          <T variant="caption" tone="danger">
            {error}
          </T>
        </Animated.View>
      )}
    </Animated.View>
  );
}
