import { capabilityRows, type CapabilityRow } from '@pocket-agent/core';
import type { AgentSessionDto } from '@pocket-agent/protocol';
import { Check, Clock, X, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { enter } from '@/lib/motion';
import { alpha, useTheme } from '@/lib/theme';
import { T } from '@/ui/core';

const ICON: Record<CapabilityRow['state'], { Icon: LucideIcon; label: string }> = {
  yes: { Icon: Check, label: 'Available' },
  soon: { Icon: Clock, label: 'Supported, not yet available' },
  no: { Icon: X, label: 'Not available' },
};

/** A hint with `code` spans: the commands to run on the PC are set in mono. */
export function Ticks({ text, variant = 'caption' }: { text: string; variant?: 'caption' | 'small' }) {
  const { c } = useTheme();
  return (
    <T variant={variant} tone="muted">
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <T
            key={i}
            variant="mono"
            style={{
              fontSize: variant === 'caption' ? 11.5 : 12.5,
              backgroundColor: c.muted,
              color: c.foreground,
            }}
          >
            {part}
          </T>
        ) : (
          part
        ),
      )}
    </T>
  );
}

export function CapabilityList({ session }: { session: AgentSessionDto }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 12 }} testID="capabilities" accessibilityRole="list">
      {capabilityRows(session).map((r, i) => {
        const { Icon, label } = ICON[r.state];
        const color = r.state === 'yes' ? c.success : r.state === 'soon' ? c.primary : c.mutedForeground;
        return (
          <Animated.View
            key={r.label}
            entering={enter.rise(i)}
            style={{ flexDirection: 'row', gap: 12 }}
            accessibilityLabel={`${r.label}: ${label}`}
          >
            <View
              style={{
                marginTop: 2,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: r.state === 'no' ? c.muted : alpha(color, 0.15),
              }}
            >
              <Icon size={12} color={color} strokeWidth={2.6} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <T variant="smallMedium">{r.label}</T>
              <Ticks text={r.detail} />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
