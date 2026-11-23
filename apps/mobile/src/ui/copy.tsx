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
import { useTheme } from '@/lib/theme';
import { Press, T, tap } from '@/ui/core';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const TICK_LENGTH = 10;

/**
 * The copy glyph and its "copied" tick, sharing one spot so nothing changes size and nothing is
 * swapped out: the copy icon recedes while a disc grows in its place and the tick is drawn inside
 * it, then it all runs back. `copied` drives it.
 */
export function CopyMark({ copied, size = 16, color }: { copied: boolean; size?: number; color?: string }) {
  const { c } = useTheme();
  const t = useSharedValue(copied ? 1 : 0);
  const draw = useSharedValue(copied ? 1 : 0);
  useEffect(() => {
    t.set(withTiming(copied ? 1 : 0, { duration: copied ? 250 : 200, easing: ease.out }));
    // The tick is drawn (not faded in) once its disc is nearly full size.
    draw.set(
      copied
        ? withDelay(100, withTiming(1, { duration: 300, easing: ease.out }))
        : withTiming(0, { duration: 150, easing: ease.out }),
    );
  }, [copied, t, draw]);
  const icon = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ scale: 1 - 0.5 * t.value }],
  }));
  const disc = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scale: 0.5 + 0.5 * t.value }],
  }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - draw.value) }));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no">
      <Animated.View style={[{ position: 'absolute', inset: 0 }, icon]}>
        <Copy size={size} color={color ?? c.mutedForeground} strokeWidth={2} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', inset: 0 }, disc]}>
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx={8} cy={8} r={8} fill={c.success} />
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

/** `[copied, copy]`: copies text to the clipboard (with a tick) and stays "copied" for a moment. */
export function useCopy(value: string, holdMs = 1600) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), holdMs);
    return () => clearTimeout(id);
  }, [copied, holdMs]);
  const copy = () => {
    tap();
    void Clipboard.setStringAsync(value)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return [copied, copy] as const;
}

/** A small "Copy" / "Copied" button whose glyph morphs into a tick. */
export function CopyButton({
  value,
  label = 'Copy',
  showLabel = true,
  testID,
}: {
  value: string;
  label?: string;
  /** Show the word next to the glyph. */
  showLabel?: boolean;
  testID?: string;
}) {
  const [copied, copy] = useCopy(value);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : `${label}: ${value}`}
      testID={testID}
      onPress={copy}
      haptic={false}
      scale={0.92}
      hitSlop={6}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 32,
        paddingHorizontal: showLabel ? 8 : 0,
        minWidth: 32,
        justifyContent: 'center',
        borderRadius: 8,
      }}
    >
      <CopyMark copied={copied} />
      {showLabel && (
        <T variant="small" tone="muted">
          {copied ? 'Copied' : label}
        </T>
      )}
    </Press>
  );
}
