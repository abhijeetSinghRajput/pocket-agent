import { Bell, CircleAlert, CircleCheck, X, type LucideIcon } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dur, ease } from '@/lib/motion';
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
  const { c, dark } = useTheme();
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
        {items.map((t) => {
          const tone = t.tone ?? 'primary';
          const Icon = ICON[tone] ?? Bell;
          const color = toneColor(c, tone);
          return (
            <Animated.View
              key={t.id}
              entering={FadeInUp.duration(dur.enter).easing(ease.out)}
              exiting={FadeOutUp.duration(dur.quick).easing(ease.out)}
              layout={LinearTransition.duration(dur.enter).easing(ease.move)}
              accessibilityRole="alert"
              style={{
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
              }}
            >
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                onPress={() => {
                  tap();
                  dismiss(t.id);
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
              <IconButton icon={X} label="Dismiss" size={32} onPress={() => dismiss(t.id)} />
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
