import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { dur, ease, pressSpring } from '@/lib/motion';
import { alpha, fonts, radius, useTheme, type Colors } from '@/lib/theme';

// ── Text ─────────────────────────────────────────────────────────────────────

const TYPE = {
  display: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 23 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  smallMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17 },
  captionMedium: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17 },
  overline: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1.4 },
  mono: { fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof TYPE;
export type Tone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'inverse';

export function toneColor(c: Colors, tone: Tone): string {
  'worklet';
  switch (tone) {
    case 'muted':
      return c.mutedForeground;
    case 'primary':
      return c.primary;
    case 'success':
      return c.success;
    case 'warning':
      return c.warning;
    case 'danger':
      return c.destructive;
    case 'inverse':
      return c.primaryForeground;
    default:
      return c.foreground;
  }
}

export function T({
  variant = 'body',
  tone = 'default',
  center,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: Tone; center?: boolean }) {
  const { c } = useTheme();
  return (
    <RNText
      {...rest}
      style={[TYPE[variant], { color: toneColor(c, tone) }, center && { textAlign: 'center' }, style]}
    />
  );
}

// ── Press feedback ───────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const tap = () => void Haptics.selectionAsync().catch(() => undefined);
export const thud = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
export const buzz = (ok: boolean) =>
  void Haptics.notificationAsync(
    ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => undefined);

/**
 * Anything you can press: squeezes a little under the finger and springs back, with a light tick.
 * `scale` is how far it squeezes (rows less than buttons).
 */
export function Press({
  children,
  style,
  scale = 0.97,
  haptic = true,
  dim = true,
  onPress,
  disabled,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  scale?: number;
  haptic?: boolean;
  /** Also fade a little while pressed. */
  dim?: boolean;
}) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scale) * pressed.value }],
    opacity: dim ? 1 - 0.14 * pressed.value : 1,
  }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.set(withSpring(1, pressSpring));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, pressSpring));
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tap();
        onPress?.(e);
      }}
      style={[style, animated, disabled && { opacity: 0.45 }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZE: Record<ButtonSize, { h: number; px: number; r: number; text: TextVariant; icon: number }> =
  {
    sm: { h: 36, px: 12, r: radius.md, text: 'smallMedium', icon: 16 },
    md: { h: 44, px: 16, r: radius.lg, text: 'bodyMedium', icon: 18 },
    lg: { h: 52, px: 20, r: radius.xl, text: 'subheading', icon: 19 },
  };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  disabled,
  full,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Fill the width. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  const s = BUTTON_SIZE[size];
  const look: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.primaryForeground },
    secondary: { bg: c.secondary, fg: c.secondaryForeground },
    outline: { bg: 'transparent', fg: c.foreground, border: c.border },
    ghost: { bg: 'transparent', fg: c.foreground },
    destructive: { bg: c.destructive, fg: '#ffffff' },
    success: { bg: c.success, fg: '#ffffff' },
  };
  const v = look[variant];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        {
          height: s.h,
          paddingHorizontal: s.px,
          borderRadius: s.r,
          backgroundColor: v.bg,
          borderWidth: v.border ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: v.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        Icon && <Icon size={s.icon} color={v.fg} strokeWidth={2.2} />
      )}
      <T variant={s.text} style={{ color: v.fg }} numberOfLines={1}>
        {label}
      </T>
    </Press>
  );
}

/** A round icon-only button. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  size = 40,
  tone = 'muted',
  filled,
  disabled,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  size?: number;
  tone?: Tone;
  filled?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      scale={0.9}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? c.secondary : 'transparent',
      }}
    >
      <Icon size={Math.round(size * 0.5)} color={toneColor(c, tone)} strokeWidth={2} />
    </Press>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, dark } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: radius.xl,
          borderWidth: dark ? 0 : StyleSheet.hairlineWidth,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

export function Spinner({ size = 'small', tone = 'primary' }: { size?: 'small' | 'large'; tone?: Tone }) {
  const { c } = useTheme();
  return <ActivityIndicator size={size} color={toneColor(c, tone)} />;
}

/** A square tinted tile holding an icon (list rows, empty states, steps). */
export function IconTile({
  icon: Icon,
  size = 44,
  tone = 'primary',
}: {
  icon: LucideIcon;
  size?: number;
  tone?: Tone;
}) {
  const { c } = useTheme();
  const color = toneColor(c, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: tone === 'muted' ? c.muted : alpha(color, 0.13),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={Math.round(size * 0.46)} color={color} strokeWidth={2} />
    </View>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function Badge({
  label,
  tone = 'muted',
  dot,
  pulse,
}: {
  label: string;
  tone?: Tone;
  /** A small status dot before the label. */
  dot?: boolean;
  /** The dot breathes (something is in progress). */
  pulse?: boolean;
}) {
  const { c } = useTheme();
  const color = toneColor(c, tone);
  return (
    <View
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
      {dot && <Dot color={color} pulse={pulse} />}
      <T variant="captionMedium" style={{ color }}>
        {label}
      </T>
    </View>
  );
}

export function Dot({ color, size = 7, pulse }: { color: string; size?: number; pulse?: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    // A slow breath while something is in progress.
    o.set(pulse ? withRepeat(withTiming(0.35, { duration: 900, easing: ease.move }), -1, true) : 1);
  }, [pulse, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

/** A count on a tab or row (approvals waiting, unread alerts). */
export function CountBubble({ count }: { count: number }) {
  const { c } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        backgroundColor: c.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RNText
        style={{ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: c.primaryForeground }}
      >
        {count > 99 ? '99+' : count}
      </RNText>
    </View>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const { c } = useTheme();
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.primary,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : (
        <RNText style={{ fontFamily: fonts.semibold, fontSize: size * 0.38, color: c.primaryForeground }}>
          {initials || '?'}
        </RNText>
      )}
    </View>
  );
}

/** Fades its content in/out when `visible` changes, without unmounting it. */
export function Fade({ visible, children }: { visible: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: dur.quick, easing: ease.out }),
  }));
  return (
    <Animated.View style={style} pointerEvents={visible ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}
