import { mmss } from '@pocket-agent/core';
import { Check, Clock, Send, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { dur, ease, enter, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Press, Spinner, T, thud, toneColor, type Tone } from '@/ui/core';
import { Roll } from '@/ui/feedback';
import { SHORT_MS, type Decision } from './shared';

/** A panel docked at the bottom of the chat rising into place (the web app's `sheet-in`). */
export const sheetIn = FadeInDown.duration(dur.sheet)
  .easing(ease.touch)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 24 }] });

const TABULAR = { fontVariant: ['tabular-nums'] as const };

/** How the countdown reads right now: calm, urgent (under a minute), or over. */
export function countdownTone(left: number, calm: Tone): Tone {
  if (left <= 0) return 'muted';
  return left < SHORT_MS ? 'danger' : calm;
}

/**
 * Time left to decide, as a pill (the card's header). Warning-tinted while there is time, urgent
 * under a minute, grey once expired; the tint eases between them.
 */
export function CountdownPill({ left }: { left: number }) {
  const { c } = useTheme();
  const tone = countdownTone(left, 'warning');
  const color = toneColor(c, tone);
  const bg = useSharedValue(0);
  useEffect(() => {
    bg.set(
      withTiming(tone === 'muted' ? 0 : tone === 'danger' ? 2 : 1, { duration: dur.enter, easing: ease.out }),
    );
  }, [tone, bg]);
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      bg.value,
      [0, 1, 2],
      [c.muted, alpha(c.warning, 0.15), alpha(c.destructive, 0.14)],
    ),
  }));
  return (
    <Animated.View
      accessibilityLabel={left <= 0 ? 'Expired' : `${mmss(left)} left to decide`}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 24,
          paddingHorizontal: 8,
          borderRadius: radius.full,
        },
        fill,
      ]}
    >
      <Clock size={12} color={color} strokeWidth={2.2} />
      <T variant="captionMedium" style={[{ color }, TABULAR]}>
        {left <= 0 ? 'Expired' : mmss(left)}
      </T>
    </Animated.View>
  );
}

/** Time left, inline (the sheets' header): "4:59 left", the number bold; "Expired" once over. */
export function CountdownInline({ left, accent }: { left: number; accent: 'warning' | 'primary' }) {
  const { c } = useTheme();
  const tone = countdownTone(left, accent);
  const numberColor = tone === 'danger' ? c.destructive : c.foreground;
  return (
    <View
      accessibilityLabel={left <= 0 ? 'Expired' : `${mmss(left)} left to decide`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <Clock size={14} color={toneColor(c, tone === 'muted' ? 'muted' : tone)} strokeWidth={2.2} />
      {left <= 0 ? (
        <T variant="caption" tone="muted">
          Expired
        </T>
      ) : (
        <T variant="caption" tone="muted" style={TABULAR}>
          <T variant="captionMedium" style={[{ color: numberColor, fontFamily: fonts.semibold }, TABULAR]}>
            {mmss(left)}
          </T>{' '}
          left
        </T>
      )}
    </View>
  );
}

type Look = 'primary' | 'outline' | 'deny';

/**
 * A big decision button (52pt, a comfortable thumb target). Primary fill for Allow / Send, outline
 * for Skip, outline with destructive text for Deny. Its own haptic is a thud (a commitment), not
 * the usual tick, so `Press`'s is off.
 */
export function BigButton({
  label,
  icon: Icon,
  look = 'primary',
  onPress,
  loading,
  disabled,
  grow = true,
  testID,
}: {
  label: string;
  icon?: LucideIcon;
  look?: Look;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Share the row equally (off for a narrow Skip). */
  grow?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const fg = look === 'primary' ? c.primaryForeground : look === 'deny' ? c.destructive : c.foreground;
  const spinnerTone: Tone = look === 'primary' ? 'inverse' : look === 'deny' ? 'danger' : 'default';
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      testID={testID}
      onPress={() => {
        thud();
        onPress();
      }}
      disabled={disabled || loading}
      haptic={false}
      style={{
        flex: grow ? 1 : undefined,
        height: 52,
        paddingHorizontal: 20,
        borderRadius: radius.xl,
        borderWidth: look === 'primary' ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: look === 'deny' ? alpha(c.destructive, 0.45) : c.border,
        backgroundColor: look === 'primary' ? c.primary : c.card,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {loading ? <Spinner tone={spinnerTone} /> : Icon && <Icon size={19} color={fg} strokeWidth={2.2} />}
      <T variant="subheading" style={{ color: fg }} numberOfLines={1}>
        {label}
      </T>
    </Press>
  );
}

/**
 * The pair that decides a permission request: Deny, then Allow. Each shows its busy word while
 * its decision is on its way; both lock meanwhile and once expired.
 */
export function DecisionButtons({
  busy,
  disabled,
  onDecide,
}: {
  busy: Decision | null;
  disabled: boolean;
  onDecide: (d: Decision) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <BigButton
        label={busy === 'deny' ? 'Denying…' : 'Deny'}
        icon={X}
        look="deny"
        loading={busy === 'deny'}
        disabled={!!busy || disabled}
        onPress={() => onDecide('deny')}
        testID="deny"
      />
      <BigButton
        label={busy === 'allow' ? 'Allowing…' : 'Allow'}
        icon={Check}
        loading={busy === 'allow'}
        disabled={!!busy || disabled}
        onPress={() => onDecide('allow')}
        testID="allow"
      />
    </View>
  );
}

/** The pair under Claude's question: Skip, then Send answer (which waits for a complete answer). */
export function AnswerButtons({
  busy,
  disabled,
  complete,
  sendLabel,
  onDecide,
}: {
  busy: Decision | null;
  disabled: boolean;
  complete: boolean;
  /** What the send button says while the answer is incomplete (the card and sheet differ). */
  sendLabel?: string;
  onDecide: (d: Decision) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <BigButton
        label={busy === 'deny' ? 'Skipping…' : 'Skip'}
        look="outline"
        grow={false}
        loading={busy === 'deny'}
        disabled={!!busy || disabled}
        onPress={() => onDecide('deny')}
        testID="skip"
      />
      <BigButton
        label={busy === 'allow' ? 'Sending…' : complete ? 'Send answer' : (sendLabel ?? 'Send answer')}
        icon={Send}
        loading={busy === 'allow'}
        disabled={!!busy || disabled || !complete}
        onPress={() => onDecide('allow')}
        testID="send-answer"
      />
    </View>
  );
}

/** The footer once the decision is out: it eases in where the buttons were. */
export function SentNote({ text }: { text: string }) {
  return (
    <Animated.View
      entering={enter.fade}
      layout={layout}
      accessibilityLiveRegion="polite"
      style={{ minHeight: 52, justifyContent: 'center' }}
    >
      <Roll text={text} variant="small" tone="muted" />
    </Animated.View>
  );
}

/** A radio (one choice) or checkbox (several) mark; it fills in with a short ease when picked. */
export function OptionMark({ on, multi, size = 22 }: { on: boolean; multi: boolean; size?: number }) {
  const { c } = useTheme();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [on, v]);
  const ring = useAnimatedStyle(() => ({
    borderColor: interpolateColor(v.value, [0, 1], [alpha(c.mutedForeground, 0.5), c.primary]),
    backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(0,0,0,0)', c.primary]),
  }));
  const inner = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.4 + 0.6 * v.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: multi ? 6 : size / 2,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ring,
      ]}
    >
      <Animated.View style={inner}>
        {multi ? (
          <Check size={size * 0.62} color={c.primaryForeground} strokeWidth={3} />
        ) : (
          <View
            style={{
              width: size * 0.36,
              height: size * 0.36,
              borderRadius: size,
              backgroundColor: c.primaryForeground,
            }}
          />
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** A thin top accent on a docked sheet (warning for permissions, primary for questions). */
export function SheetFrame({
  accent,
  children,
  testID,
}: {
  accent: string;
  children: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Animated.View
      entering={sheetIn}
      testID={testID}
      style={{
        backgroundColor: c.popover,
        borderTopLeftRadius: radius.xxl,
        borderTopRightRadius: radius.xxl,
        borderTopWidth: 3,
        borderTopColor: accent,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: -6 },
        elevation: 8,
      }}
    >
      {children}
    </Animated.View>
  );
}
