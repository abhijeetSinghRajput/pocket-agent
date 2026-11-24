import { timeAgo } from '@pocket-agent/core';
import type { ClaudeUsage } from '@pocket-agent/protocol';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useDevices } from '@/lib/data';
import { ease, enter, exit, layout } from '@/lib/motion';
import { alpha, useTheme } from '@/lib/theme';
import { Card, T } from '@/ui/core';
import { Count, Notice, Skeleton } from '@/ui/feedback';

/** "Resets at 1:30 PM" today, "Resets Fri, Nov 27 at 1:30 AM" otherwise. */
export function resetLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Resets at ${time}`;
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Resets ${day} at ${time}`;
}

/** "Max 5x plan · Claude login on this PC valid until Dec 20, 2026". */
export function planLine(plan: string | null, loginExpiresAt: string | null): string {
  const d = loginExpiresAt ? new Date(loginExpiresAt) : null;
  const until =
    d && !Number.isNaN(d.getTime())
      ? d.getTime() <= Date.now()
        ? 'PC sign-in to Claude has expired'
        : `PC sign-in to Claude valid until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : null;
  return [plan ? `${plan} plan` : null, until].filter(Boolean).join(' · ');
}

function Meter({ label, percent, resetsAt }: { label: string; percent: number; resetsAt: string | null }) {
  const { c } = useTheme();
  const value = Math.round(Math.max(0, Math.min(100, percent)));
  // Starts empty and fills to its value, so the bar is seen arriving; the number counts along.
  const fill = useSharedValue(0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    fill.set(withDelay(60, withTiming(value / 100, { duration: 700, easing: ease.out })));
    const t = setTimeout(() => setShown(Math.round(percent)), 60);
    return () => clearTimeout(t);
  }, [value, percent, fill]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  const color = value >= 90 ? c.destructive : value >= 75 ? c.warning : c.primary;
  const reset = resetLabel(resetsAt);
  return (
    <View testID="usage-meter">
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}
      >
        <T variant="smallMedium" style={{ flexShrink: 1 }} numberOfLines={1}>
          {label}
        </T>
        <Count value={shown} suffix="%" variant="small" />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: value }}
        style={{
          marginTop: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: alpha(c.foreground, 0.1),
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            { height: 6, borderRadius: 3, width: '100%', backgroundColor: color, transformOrigin: 'left' },
            bar,
          ]}
        />
      </View>
      {reset && (
        <T variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {reset}
        </T>
      )}
    </View>
  );
}

function Meters({ usage }: { usage: ClaudeUsage }) {
  return (
    <View style={{ gap: 16 }}>
      {usage.session && <Meter label="Session (5hr)" {...usage.session} />}
      {usage.weekly && <Meter label="Weekly (7 day)" {...usage.weekly} />}
      {usage.models.map((m) => (
        <Meter key={m.name} label={`${m.name} limit`} percent={m.percent} resetsAt={m.resetsAt} />
      ))}
    </View>
  );
}

/**
 * The Claude plan usage of the account signed in on each PC: the same numbers as Claude Code's own
 * /usage. Read by the PC every few minutes; nothing here is estimated.
 */
export function ClaudeUsageCard() {
  const { state } = useDevices();
  const devices = (state.data ?? []).filter((d) => d.status !== 'Revoked');
  const reporting = devices.filter(
    (d) => d.usage && (d.usage.session || d.usage.weekly || d.usage.models.length),
  );

  // Says exactly why there is nothing to show: the words match the status on the Devices tab.
  const empty = !devices.length
    ? { title: 'No PC paired', hint: 'Pair a PC to see your usage.' }
    : devices.some((d) => d.status === 'Online')
      ? { title: 'No usage from your PC yet', hint: 'Update Pocket Agent on it to see your usage.' }
      : { title: 'Your PC is offline', hint: 'Usage shows up when it is online.' };

  return (
    <View testID="claude-usage">
      <Card style={{ padding: 16 }}>
        <T variant="overline" tone="muted" accessibilityRole="header">
          CLAUDE USAGE
        </T>
        <Animated.View layout={layout}>
          {state.status === 'loading' && (
            <Animated.View key="loading" entering={enter.fade} exiting={exit.fade} style={{ marginTop: 12 }}>
              <Skeleton height={96} round={10} />
            </Animated.View>
          )}
          {state.status === 'error' && (
            <Animated.View key="error" entering={enter.fade} style={{ marginTop: 12 }}>
              <Notice>{state.error}</Notice>
            </Animated.View>
          )}
          {state.status === 'ready' && reporting.length === 0 && (
            <Animated.View
              key="empty"
              entering={enter.fade}
              exiting={exit.fade}
              testID="no-usage"
              style={{
                alignItems: 'center',
                paddingHorizontal: 8,
                paddingTop: 4,
                paddingBottom: 12,
                gap: 2,
              }}
            >
              {/* The same picture as the web app. */}
              <Image
                source={require('../../../assets/images/pc-offline.webp')}
                accessible={false}
                style={{ width: 240, aspectRatio: 768 / 512, borderRadius: 16 }}
                contentFit="contain"
              />
              <T variant="smallMedium" center style={{ marginTop: 4 }}>
                {empty.title}
              </T>
              <T variant="small" tone="muted" center>
                {empty.hint}
              </T>
            </Animated.View>
          )}
          {reporting.length > 0 && (
            <View style={{ marginTop: 12, gap: 24 }}>
              {reporting.map((d, i) => (
                <Animated.View key={d.id} entering={enter.rise(i)} exiting={exit.fade} layout={layout}>
                  {/* The PC's name only matters when there is more than one. */}
                  {reporting.length > 1 && (
                    <T variant="smallMedium" style={{ marginBottom: 8 }}>
                      {d.name}
                    </T>
                  )}
                  <Meters usage={d.usage!} />
                  <T variant="caption" tone="muted" style={{ marginTop: 12 }}>
                    {reporting.length === 1 && `${d.name} · `}Updated {timeAgo(d.usage!.updatedAt)}
                  </T>
                  {(d.usage!.plan || d.usage!.loginExpiresAt) && (
                    <T variant="caption" tone="muted" style={{ marginTop: 2 }} testID="usage-plan">
                      {planLine(d.usage!.plan ?? null, d.usage!.loginExpiresAt ?? null)}
                    </T>
                  )}
                </Animated.View>
              ))}
            </View>
          )}
        </Animated.View>
      </Card>
    </View>
  );
}
