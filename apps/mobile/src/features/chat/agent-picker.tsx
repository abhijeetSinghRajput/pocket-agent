import { agentName } from '@pocket-agent/core';
import type { ProviderId } from '@pocket-agent/protocol';
import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AgentLogo, agentColor } from '@/features/sessions/badges';
import { dur, ease, enter, exit } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Press, T, tap } from '@/ui/core';

const COLUMNS = 3;

function AgentTile({
  provider,
  selected,
  index,
  onPress,
}: {
  provider: ProviderId;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  const { c, dark } = useTheme();
  // The picked tile eases into its orange edge and wash; the one it left eases out.
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [selected, on]);
  const frame = useAnimatedStyle(() => ({
    borderColor: interpolateColor(on.value, [0, 1], [c.border, c.primary]),
    backgroundColor: interpolateColor(on.value, [0, 1], [c.card, alpha(c.primary, 0.12)]),
  }));
  const name = agentName(provider);
  return (
    <Animated.View entering={enter.rise(index)} style={{ flex: 1 }}>
      <Press
        onPress={() => {
          if (selected) return;
          tap();
          onPress();
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={name}
        testID={`agent-${provider}`}
        style={{ borderRadius: radius.lg }}
      >
        <Animated.View
          style={[
            {
              height: 84,
              borderRadius: radius.lg,
              borderWidth: 1.5,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            },
            frame,
          ]}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.md,
              backgroundColor: alpha(agentColor(provider, dark), 0.14),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AgentLogo provider={provider} size={22} />
          </View>
          <T variant="captionMedium" numberOfLines={1} tone={selected ? 'default' : 'muted'}>
            {name}
          </T>
          {selected && (
            <Animated.View
              entering={enter.pop}
              exiting={exit.fade}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: c.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={11} color="#fff" strokeWidth={3.2} />
            </Animated.View>
          )}
        </Animated.View>
      </Press>
    </Animated.View>
  );
}

/**
 * Which agent a new chat starts: a grid of tiles, three to a row, Claude first and then every other
 * agent the PC can start. The picked one has the accent edge and a tick.
 */
export function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: ProviderId[];
  value: ProviderId;
  onChange: (next: ProviderId) => void;
}) {
  const rows: ProviderId[][] = [];
  for (let i = 0; i < agents.length; i += COLUMNS) rows.push(agents.slice(i, i + COLUMNS));
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Agent" testID="agent-choice" style={{ gap: 8 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((p, i) => (
            <AgentTile
              key={p}
              provider={p}
              index={r * COLUMNS + i}
              selected={p === value}
              onPress={() => onChange(p)}
            />
          ))}
          {/* A short last row keeps the tiles the same width as the rows above */}
          {Array.from({ length: COLUMNS - row.length }, (_, k) => (
            <View key={`gap-${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}
