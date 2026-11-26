import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Pressable, TextInput, View, type LayoutChangeEvent, type TextInputProps } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { dur, ease, settleSpring } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { playSound } from '@/lib/sound';
import { T, tap } from '@/ui/core';

/** A labelled text field. The border warms to the accent while focused; an error shows under it. */
export function Field({
  label,
  error,
  hint,
  right,
  ref,
  ...input
}: TextInputProps & {
  label: string;
  error?: string | null;
  hint?: string;
  right?: ReactNode;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const { c } = useTheme();
  const focus = useSharedValue(0);
  const border = useAnimatedStyle(() => ({
    borderColor: error ? c.destructive : interpolateColor(focus.value, [0, 1], [c.input, c.primary]),
  }));
  return (
    <View style={{ gap: 6 }}>
      <T variant="smallMedium">{label}</T>
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            height: 50,
            borderRadius: radius.lg,
            borderWidth: 1.5,
            backgroundColor: c.card,
            paddingHorizontal: 14,
          },
          border,
        ]}
      >
        <TextInput
          {...input}
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.primary}
          onFocus={(e) => {
            focus.set(withTiming(1, { duration: dur.quick, easing: ease.out }));
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.set(withTiming(0, { duration: dur.quick, easing: ease.out }));
            input.onBlur?.(e);
          }}
          style={{
            flex: 1,
            fontFamily: fonts.regular,
            fontSize: 16,
            color: c.foreground,
            paddingVertical: 0,
          }}
        />
        {right}
      </Animated.View>
      {error ? (
        <T variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" tone="muted">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** On/off switch; the knob slides on a spring and the track warms to the accent. */
export function Toggle({
  value,
  onChange,
  label,
  disabled,
  testID,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(withSpring(value ? 1 : 0, settleSpring));
  }, [value, on]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [c.input, c.primary]),
  }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * 20 }] }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        tap();
        playSound('print');
        onChange(!value);
      }}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={[{ width: 48, height: 28, borderRadius: 14, padding: 3 }, track]}>
        <Animated.View
          style={[
            {
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: '#ffffff',
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
            knob,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

/** A row of choices where one is chosen; the highlight slides to the choice. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  compact,
  large,
  strong,
  disabled,
  label,
  testID,
}: {
  options: { value: V; label: string; icon?: LucideIcon }[];
  value: V;
  onChange: (next: V) => void;
  /** Smaller text, for many short choices in one row. */
  compact?: boolean;
  /** Taller, for a choice that switches the whole screen below it. */
  large?: boolean;
  /** The choice filled with the accent, on a clearer track (on sheets, where the plain one fades). */
  strong?: boolean;
  disabled?: boolean;
  label?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const seg = width ? (width - 6) / options.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.set(withSpring(index * seg, settleSpring));
  }, [index, seg, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={{
        flexDirection: 'row',
        backgroundColor: strong ? c.background : c.muted,
        borderRadius: radius.lg,
        borderWidth: strong ? 1 : 0,
        borderColor: c.border,
        padding: strong ? 2 : 3,
        height: large ? 52 : 40,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {seg > 0 && (
        <Animated.View
          style={[
            {
              // Inside the border and padding, the same gap on every side.
              position: 'absolute',
              top: strong ? 2 : 3,
              left: strong ? 2 : 3,
              width: seg,
              height: (large ? 52 : 40) - (strong ? 4 : 6),
              borderRadius: large ? radius.lg : radius.md + 1,
              backgroundColor: strong ? c.primary : c.card,
              shadowColor: '#000',
              shadowOpacity: 0.08,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 1,
            },
            pill,
          ]}
        />
      )}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={o.label}
            disabled={disabled}
            onPress={() => {
              if (!selected) {
                tap();
                playSound('print');
              }
              onChange(o.value);
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 0,
            }}
          >
            {o.icon && (
              <o.icon
                size={17}
                strokeWidth={2.1}
                color={
                  strong
                    ? selected
                      ? c.primaryForeground
                      : c.mutedForeground
                    : selected
                      ? c.foreground
                      : c.mutedForeground
                }
              />
            )}
            <T
              variant={compact ? 'captionMedium' : 'smallMedium'}
              tone={selected ? 'default' : 'muted'}
              numberOfLines={1}
              style={[
                compact && { fontSize: 11.5 },
                strong && {
                  color: selected ? c.primaryForeground : o.icon ? c.mutedForeground : c.foreground,
                },
                large && { fontSize: 15 },
                strong && selected && { fontFamily: fonts.semibold },
              ]}
            >
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
