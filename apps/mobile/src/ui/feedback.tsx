import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeOut,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';
import { dur, ease, enter } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Button, IconTile, T, toneColor, type TextVariant, type Tone } from '@/ui/core';

/** A placeholder at the content's own geometry while it loads; it breathes softly. */
export function Skeleton({
  width = '100%',
  height = 14,
  round = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  round?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const o = useSharedValue(0.55);
  useEffect(() => {
    o.set(withRepeat(withTiming(1, { duration: 850, easing: ease.move }), -1, true));
  }, [o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: c.muted }, pulse, style]} />
  );
}

/** A word or short label that changes: the old one rolls out upwards as the new one rolls in. */
export function Roll({
  text,
  variant = 'smallMedium',
  tone = 'default',
  color,
}: {
  text: string;
  variant?: TextVariant;
  tone?: Tone;
  color?: string;
}) {
  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View key={text} entering={enter.roll} exiting={FadeOut.duration(dur.quick).easing(ease.out)}>
        <T variant={variant} tone={tone} style={color ? { color } : undefined} numberOfLines={1}>
          {text}
        </T>
      </Animated.View>
    </View>
  );
}

/** A number that counts to its new value instead of jumping. */
export function Count({
  value,
  suffix = '',
  variant = 'title',
  tone = 'default',
}: {
  value: number;
  suffix?: string;
  variant?: TextVariant;
  tone?: Tone;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown;
    if (from === value) return;
    const start = Date.now();
    const total = 520;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / total);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (t >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
    // `shown` is the starting point only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <T variant={variant} tone={tone} style={{ fontVariant: ['tabular-nums'] }}>
      {shown}
      {suffix}
    </T>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const TICK_LENGTH = 21;

/**
 * Success: the badge settles in, one ring breathes out behind it, and the tick draws itself.
 * A rare moment (a PC connecting, a request approved), so it may take a little longer than
 * ordinary feedback.
 */
export function SuccessTick({ size = 128 }: { size?: number }) {
  const { c } = useTheme();
  const badge = useSharedValue(0);
  const ring = useSharedValue(0);
  const draw = useSharedValue(0);
  useEffect(() => {
    badge.set(withTiming(1, { duration: 420, easing: ease.out }));
    ring.set(withDelay(260, withTiming(1, { duration: 900, easing: ease.out })));
    draw.set(withDelay(240, withTiming(1, { duration: 380, easing: ease.out })));
  }, [badge, ring, draw]);
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: 0.9 + 0.1 * badge.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value === 0 ? 0 : 0.5 * (1 - ring.value),
    transform: [{ scale: 1 + 0.55 * ring.value }],
  }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - draw.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: c.success,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: c.success,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: c.success,
            shadowOpacity: 0.5,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 12,
          },
          badgeStyle,
        ]}
      >
        <Svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="#ffffff"
            strokeWidth={2.6}
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

/** What a list says when it has nothing to show. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <Animated.View
      entering={enter.rise()}
      style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 6 }}
    >
      <IconTile icon={icon} size={56} tone="muted" />
      <T variant="subheading" center style={{ marginTop: 10 }}>
        {title}
      </T>
      {body && (
        <T variant="small" tone="muted" center>
          {body}
        </T>
      )}
      {children}
      {action && onAction && (
        <Button label={action} onPress={onAction} style={{ marginTop: 14, alignSelf: 'center' }} />
      )}
    </Animated.View>
  );
}

/** An inline message: something went wrong, or needs attention. */
export function Notice({ tone = 'danger', children }: { tone?: Tone; children: ReactNode }) {
  const { c } = useTheme();
  const color = toneColor(c, tone);
  return (
    <Animated.View
      entering={enter.fade}
      accessibilityRole="alert"
      style={{
        backgroundColor: alpha(color, 0.12),
        borderRadius: radius.md,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <T variant="small" style={{ color }}>
        {children}
      </T>
    </Animated.View>
  );
}
