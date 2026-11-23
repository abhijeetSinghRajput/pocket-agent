import type { DeviceStatus } from '@pocket-agent/protocol';
import { View } from 'react-native';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Dot, toneColor, type Tone } from '@/ui/core';
import { Roll } from '@/ui/feedback';

const TONE: Record<DeviceStatus, Tone> = { Online: 'success', Offline: 'muted', Revoked: 'danger' };

/** Online / Offline / Revoked as a small pill; the word rolls when it changes, Online breathes. */
export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const { c } = useTheme();
  const tone = TONE[status];
  const color = toneColor(c, tone);
  return (
    <View
      testID="device-status"
      accessibilityLabel={status}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 9,
        height: 24,
        borderRadius: radius.full,
        backgroundColor: tone === 'muted' ? c.muted : alpha(color, 0.14),
        alignSelf: 'flex-start',
      }}
    >
      <Dot
        color={status === 'Offline' ? alpha(c.mutedForeground, 0.5) : color}
        size={6}
        pulse={status === 'Online'}
      />
      <Roll text={status} variant="captionMedium" color={color} />
    </View>
  );
}
