import { AwayMode } from '@/features/devices/away-mode';
import { useDevices } from '@/lib/data';
import { Card, Divider, T } from '@/ui/core';
import { View } from 'react-native';

/** Away mode of each paired PC, here as well as under Devices. */
export function AwayModeCard() {
  const devices = (useDevices().state.data ?? []).filter((d) => d.status !== 'Revoked');
  if (!devices.length) return null;
  return (
    <Card style={{ padding: 16 }}>
      <T variant="overline" tone="muted" accessibilityRole="header" style={{ marginBottom: 12 }}>
        AWAY MODE
      </T>
      {devices.map((d, i) => (
        <View key={d.id} style={{ gap: 6 }}>
          {i > 0 && (
            <View style={{ marginVertical: 10 }}>
              <Divider />
            </View>
          )}
          {devices.length > 1 && (
            <T variant="caption" tone="muted" numberOfLines={1}>
              {d.name}
            </T>
          )}
          <AwayMode key={`${d.id}-${String(d.awayMode)}`} device={d} />
        </View>
      ))}
    </Card>
  );
}
