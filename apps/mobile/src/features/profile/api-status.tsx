import { HealthResponse } from '@pocket-agent/protocol';
import { useIsFocused } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { API_URL } from '@/lib/api';
import { enter, exit, layout } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Card, Dot, Press, T, tap, toneColor, type Tone } from '@/ui/core';
import { Roll, Skeleton } from '@/ui/feedback';

const POLL_MS = 15_000;
/** A check shows as running for at least this long, so the button doesn't flicker. */
const MIN_CHECK_MS = 600;

export type HealthResult =
  { kind: 'ok' | 'degraded'; health: HealthResponse } | { kind: 'unreachable'; error: string };

/**
 * Fetches API health. The API returns 503 with a valid body when degraded, so the body is parsed
 * regardless of status. Any network/parse failure is reported as unreachable, never as healthy.
 */
async function fetchHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const res = await fetch(`${API_URL}/health`, { signal, credentials: 'omit' });
    const parsed = HealthResponse.safeParse(await res.json());
    if (!parsed.success) return { kind: 'unreachable', error: 'Unexpected response from API' };
    return { kind: parsed.data.status, health: parsed.data };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return { kind: 'unreachable', error: 'Cannot reach the Pocket Agent API' };
  }
}

const TONE: Record<HealthResult['kind'], Tone> = {
  ok: 'success',
  degraded: 'warning',
  unreachable: 'danger',
};

/** "12s ago" / "1m 05s ago": how long since the last check, ticking every second. */
function since(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s ago`;
}

/** The time of the last check, counting up while on screen. */
function Age({ at, color }: { at: number; color: string }) {
  // A fresh `at` is never behind `now`, so the first tick after a check reads "0s ago".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  return (
    <T
      variant="captionMedium"
      accessibilityLabel={`Last checked ${since(at, now)}`}
      style={{ color, fontVariant: ['tabular-nums'] }}
    >
      {since(at, now)}
    </T>
  );
}

/** The refresh glyph; it turns while a check is running. */
function Spin({ checking, color }: { checking: boolean; color: string }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (checking) turn.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1));
    else {
      cancelAnimation(turn);
      turn.set(0);
    }
  }, [checking, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return (
    <Animated.View style={style}>
      <RefreshCw size={18} color={color} strokeWidth={2.2} />
    </Animated.View>
  );
}

function Tile({ name, tone, value }: { name: string; tone: Tone; value: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: radius.md,
        backgroundColor: c.muted,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Dot color={tone === 'muted' ? alpha(c.mutedForeground, 0.4) : toneColor(c, tone)} size={8} />
        <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </T>
      </View>
      <Roll text={value} variant="mono" />
    </View>
  );
}

/** Whether the API behind the app is up, with its dependencies and version. Checks while on screen. */
export function ApiStatus() {
  const { c } = useTheme();
  const focused = useIsFocused();
  const [result, setResult] = useState<HealthResult | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setChecking(true);
    try {
      const [next] = await Promise.all([
        fetchHealth(ctl.signal),
        new Promise((r) => setTimeout(r, MIN_CHECK_MS)),
      ]);
      if (ctl.signal.aborted) return;
      setResult(next);
      setCheckedAt(Date.now());
    } catch {
      /* aborted by a newer check */
    } finally {
      if (controller.current === ctl) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!focused) return;
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      controller.current?.abort();
    };
  }, [refresh, focused]);

  // The badge: how long ago the API was last checked, in the colour of what it said.
  const tone: Tone = result ? TONE[result.kind] : 'muted';
  const badgeColor = toneColor(c, tone);

  return (
    <View testID="api-status" accessibilityState={{ busy: checking }}>
      <Card style={{ padding: 16 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <T variant="overline" tone="muted" accessibilityRole="header">
            BACKEND
          </T>
          <View
            style={{
              paddingHorizontal: 9,
              height: 24,
              justifyContent: 'center',
              borderRadius: radius.full,
              backgroundColor: tone === 'muted' ? c.muted : alpha(badgeColor, 0.14),
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
            testID="api-checked"
          >
            {result && <Dot color={badgeColor} size={7} />}
            {checkedAt === null ? (
              <Roll text="Checking…" variant="captionMedium" color={badgeColor} />
            ) : (
              <Age at={checkedAt} color={badgeColor} />
            )}
          </View>
        </View>

        <Animated.View layout={layout}>
          {result === null && (
            <Animated.View key="loading" exiting={exit.fade} style={{ marginTop: 12 }}>
              <Skeleton height={58} round={radius.md} />
            </Animated.View>
          )}
          {result?.kind === 'unreachable' && (
            <Animated.View
              key="down"
              entering={enter.fade}
              exiting={exit.fade}
              accessibilityRole="alert"
              style={{ marginTop: 12 }}
            >
              <T variant="small" tone="danger">
                {result.error}
              </T>
            </Animated.View>
          )}
          {result && result.kind !== 'unreachable' && (
            <Animated.View
              key="tiles"
              entering={enter.fade}
              exiting={exit.fade}
              style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}
            >
              {(
                [
                  { name: 'Database', dep: result.health.checks.database },
                  { name: 'Redis', dep: result.health.checks.redis },
                ] as const
              ).map(({ name, dep }) => (
                <Tile
                  key={name}
                  name={name}
                  tone={dep.status === 'up' ? 'success' : 'danger'}
                  value={dep.status === 'up' ? `${dep.latencyMs ?? 0} ms` : (dep.error ?? 'down')}
                />
              ))}
              <Tile name="API version" tone="muted" value={result.health.version} />
            </Animated.View>
          )}
        </Animated.View>

        <Press
          accessibilityRole="button"
          accessibilityLabel={checking ? 'Checking' : 'Check now'}
          accessibilityState={{ disabled: checking, busy: checking }}
          disabled={checking}
          onPress={() => {
            tap();
            void refresh();
          }}
          haptic={false}
          style={{
            marginTop: 12,
            height: 44,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Spin checking={checking} color={c.foreground} />
          <Roll text={checking ? 'Checking' : 'Check now'} variant="bodyMedium" />
        </Press>
      </Card>
    </View>
  );
}
