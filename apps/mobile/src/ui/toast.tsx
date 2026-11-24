import { Bell, CircleAlert, CircleCheck, X, type LucideIcon } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  FadeOutUp,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { dur, ease, settleSpring } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { IconButton, T, tap, toneColor, type Tone } from '@/ui/core';

export interface ToastInput {
  title: string;
  body?: string;
  tone?: Tone;
  /** Runs when the toast is tapped (it also closes). */
  onPress?: () => void;
  /** Same key replaces an earlier toast instead of stacking. */
  key?: string;
}
interface ToastItem extends ToastInput {
  id: string;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);
const SHOW_MS = 5200;
const MAX = 3;

const ICON: Partial<Record<Tone, LucideIcon>> = { success: CircleCheck, danger: CircleAlert };

/**
 * Small messages that slide in under the status bar and leave by themselves: something happened
 * elsewhere in the app (Claude finished in another chat), or an action here succeeded or failed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => setItems((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: ToastInput) => {
      const id = t.key ?? `t${++seq.current}`;
      setItems((list) => [{ ...t, id }, ...list.filter((x) => x.id !== id)].slice(0, MAX));
      setTimeout(() => dismiss(id), SHOW_MS);
    },
    [dismiss],
  );
  const api = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 8, zIndex: 100 }}
      >
        {items.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

/** How far a toast must be dragged (share of its width), or how fast flicked, to go away. */
const SWIPE_AWAY = 0.35;
const FLICK = 800;

/**
 * One toast, handled like the phone's own notifications: tap it to open what it is about, swipe it
 * left, right or up to dismiss it; let go short of that and it springs back.
 */
function ToastCard({ toast: t, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { c, dark } = useTheme();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const tone = t.tone ?? 'primary';
  const Icon = ICON[tone] ?? Bell;
  const color = toneColor(c, tone);

  // Swiped away: a light tick.
  const swiped = () => {
    tap();
    onDismiss();
  };
  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    activeOffsetY: -12,
    onUpdate: (e) => {
      'worklet';
      x.set(e.translationX);
      y.set(Math.min(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      const sideways = Math.abs(e.translationX) > width * SWIPE_AWAY || Math.abs(e.velocityX) > FLICK;
      const up = e.translationY < -40 || e.velocityY < -FLICK;
      if (sideways) {
        const to = (e.translationX + e.velocityX * 0.1 < 0 ? -1 : 1) * width;
        x.set(
          withTiming(to, { duration: dur.quick, easing: ease.out }, (done) => done && scheduleOnRN(swiped)),
        );
      } else if (up) {
        y.set(
          withTiming(-160, { duration: dur.quick, easing: ease.out }, (done) => done && scheduleOnRN(swiped)),
        );
      } else {
        x.set(withSpring(0, settleSpring));
        y.set(withSpring(0, settleSpring));
      }
    },
  });
  const drag = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    opacity: 1 - Math.min(0.7, Math.abs(x.value) / width + Math.abs(y.value) / 200),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeInUp.duration(dur.enter).easing(ease.out)}
        exiting={FadeOutUp.duration(dur.quick).easing(ease.out)}
        layout={LinearTransition.duration(dur.enter).easing(ease.move)}
        accessibilityRole="alert"
        accessibilityHint="Swipe left, right or up to dismiss"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: c.popover,
            borderRadius: radius.xl,
            borderWidth: dark ? 0 : 1,
            borderColor: c.border,
            padding: 12,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          },
          drag,
        ]}
      >
        <Pressable
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
          onPress={() => {
            tap();
            onDismiss();
            t.onPress?.();
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: alpha(color, 0.14),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={17} color={color} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="smallMedium" numberOfLines={1}>
              {t.title}
            </T>
            {t.body && (
              <T variant="caption" tone="muted" numberOfLines={2}>
                {t.body}
              </T>
            )}
          </View>
        </Pressable>
        <IconButton icon={X} label="Dismiss" size={32} onPress={onDismiss} />
      </Animated.View>
    </GestureDetector>
  );
}

export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
