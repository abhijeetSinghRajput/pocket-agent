import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Path, Svg } from 'react-native-svg';
import { ease } from '@/lib/motion';
import { radius, useTheme } from '@/lib/theme';
import { Press, thud } from '@/ui/core';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const TICK_LENGTH = 10;

/**
 * The copy glyph and its "copied" tick, sharing one spot so the button never changes size and
 * nothing is swapped out: the copy icon recedes while a disc grows in its place and the tick is
 * drawn inside it, then it all runs back. `copied` drives it.
 */
export function CopyMark({ copied, size = 16, color }: { copied: boolean; size?: number; color: string }) {
  const { c } = useTheme();
  const on = useSharedValue(copied ? 1 : 0);
  const draw = useSharedValue(copied ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(copied ? 1 : 0, { duration: copied ? 250 : 200, easing: ease.out }));
    draw.set(
      copied
        ? withDelay(100, withTiming(1, { duration: 300, easing: ease.out }))
        : withTiming(0, { duration: 150, easing: ease.out }),
    );
  }, [copied, on, draw]);
  const glyph = useAnimatedStyle(() => ({
    opacity: 1 - on.value,
    transform: [{ scale: 1 - 0.5 * on.value }],
  }));
  const disc = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: 0.5 + 0.5 * on.value }],
  }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - draw.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      <Animated.View style={[{ position: 'absolute' }, glyph]}>
        <Copy size={size} color={color} strokeWidth={2} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, disc]}>
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <AnimatedCircle cx={8} cy={8} r={8} fill={c.success} />
          <AnimatedPath
            d="M4.6 8.3 7 10.6l4.4-5"
            stroke="#ffffff"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={TICK_LENGTH}
            animatedProps={tick}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** `[copied, copy]`: copies text and stays "copied" for a moment. */
export function useCopy(value: string, holdMs = 1600) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), holdMs);
    return () => clearTimeout(id);
  }, [copied, holdMs]);
  const copy = () => {
    void Clipboard.setStringAsync(value)
      .then(() => {
        thud();
        setCopied(true);
      })
      .catch(() => undefined);
  };
  return [copied, copy] as const;
}

/** A small square button that copies `value`; its icon turns into a tick for a moment. */
export function CopyButton({
  value,
  label = 'Copy',
  size = 36,
  color,
  testID,
}: {
  value: string;
  label?: string;
  size?: number;
  color?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [copied, copy] = useCopy(value);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : label}
      testID={testID}
      onPress={copy}
      haptic={false}
      scale={0.9}
      hitSlop={6}
      style={{ width: size, height: size, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}
    >
      <CopyMark copied={copied} size={Math.round(size * 0.44)} color={color ?? c.mutedForeground} />
    </Press>
  );
}
