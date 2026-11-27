import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { T } from '@/ui/core';

/** The wavy hairline of a separator (the web's .wavy-rule). */
export function WavyRule() {
  const { c } = useTheme();
  const waves = 80;
  let d = 'M0 3';
  for (let i = 0; i < waves; i++) d += ` Q${i * 12 + 3} 0 ${i * 12 + 6} 3 T${i * 12 + 12} 3`;
  return (
    <View aria-hidden style={{ flex: 1, height: 6, overflow: 'hidden' }}>
      <Svg width={waves * 12} height={6} viewBox={`0 0 ${waves * 12} 6`}>
        <Path d={d} fill="none" stroke={c.mutedForeground} strokeOpacity={0.35} strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

/** A label between two wavy hairlines: a chat's "Today", a list's "Not installed". */
export function LabelSeparator({ label }: { label: string }) {
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}
    >
      <WavyRule />
      <T variant="captionMedium" tone="muted">
        {label}
      </T>
      <WavyRule />
    </View>
  );
}
