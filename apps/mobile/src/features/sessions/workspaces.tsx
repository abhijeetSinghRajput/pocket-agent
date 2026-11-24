import type { DeviceDto } from '@pocket-agent/protocol';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PLATFORM } from '@/features/devices/device-status';
import { FolderRow, NewChatSheet, type Place } from '@/features/sessions/new-chat-sheet';
import { useDevices } from '@/lib/data';
import { dur, ease, enter } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Dot, Press, T } from '@/ui/core';
import { Notice, Skeleton } from '@/ui/feedback';
import { TerminalGuide } from '@/ui/terminal-guide';

const CARD_WIDTH = 150;

/** One PC in the strip: tap to show only its workspaces, tap again to show all. */
function DeviceCard({
  device,
  index,
  selected,
  onPress,
}: {
  device: DeviceDto;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const { icon: Icon, label } = PLATFORM[device.platform];
  const online = device.status === 'Online';
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [selected, on]);
  const frame = useAnimatedStyle(() => ({
    borderColor: interpolateColor(on.value, [0, 1], [c.border, c.primary]),
    backgroundColor: interpolateColor(on.value, [0, 1], [c.card, alpha(c.primary, 0.08)]),
  }));
  const count = device.projects.length;
  return (
    <Animated.View
      entering={enter.rise(index)}
      style={[{ borderRadius: radius.xl, borderWidth: 1.5 }, frame]}
    >
      <Press
        accessibilityRole="button"
        accessibilityLabel={`${device.name}, ${device.status}, ${count} workspaces`}
        accessibilityState={{ selected }}
        testID="workspace-device"
        onPress={onPress}
        scale={0.96}
        style={{ width: CARD_WIDTH, padding: 12, gap: 10, borderRadius: radius.xl }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            backgroundColor: online ? alpha(c.primary, 0.13) : c.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={18} color={online ? c.primary : c.mutedForeground} strokeWidth={2} />
        </View>
        <View style={{ gap: 2 }}>
          <T variant="bodyMedium" numberOfLines={1}>
            {device.name}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Dot color={online ? c.success : alpha(c.mutedForeground, 0.5)} size={6} pulse={online} />
            <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {online ? 'Online' : 'Offline'} · {label}
            </T>
          </View>
          <T variant="caption" tone="muted">
            {count === 1 ? '1 workspace' : `${count} workspaces`}
          </T>
        </View>
      </Press>
    </Animated.View>
  );
}

/**
 * No active chats: every paired PC in a strip you swipe sideways, and the workspaces (the folders
 * allowed on each PC) below. Tapping a workspace opens a new chat there.
 */
export function Workspaces() {
  const { state } = useDevices();
  const [picked, setPicked] = useState<string | null>(null);
  // The workspace open in the New chat browser, if any.
  const [browsing, setBrowsing] = useState<Place | null>(null);

  if (state.data === null) {
    return state.error ? (
      <Notice>{state.error}</Notice>
    ) : (
      <View accessibilityState={{ busy: true }} style={{ flexDirection: 'row', gap: 10 }}>
        <Skeleton width={CARD_WIDTH} height={124} round={radius.xl} />
        <Skeleton width={CARD_WIDTH} height={124} round={radius.xl} />
      </View>
    );
  }

  const devices = state.data.filter((d) => d.status !== 'Revoked');
  // A PC picked earlier that is gone now shows them all again.
  const selected = devices.find((d) => d.id === picked) ?? null;
  const shown = selected ? [selected] : devices;
  // Where each PC's rows start, so the whole list arrives in reading order.
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((n, d) => n + d.projects.length, 0));
  const total = shown.reduce((n, d) => n + d.projects.length, 0);

  // A workspace opens in the New chat browser, inside that folder: pick a folder in it, or open it.
  const browse = (d: DeviceDto, p: { name: string; path: string }) =>
    setBrowsing({ deviceId: d.id, name: p.name, path: p.path });

  return (
    <View style={{ gap: 12 }} testID="workspaces">
      <T variant="overline" tone="muted">
        Devices
      </T>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="workspace-devices"
        // Edge to edge: the strip scrolls under the screen's margins.
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
      >
        {devices.map((d, i) => (
          <DeviceCard
            key={d.id}
            device={d}
            index={i}
            selected={selected?.id === d.id}
            onPress={() => setPicked((p) => (p === d.id ? null : d.id))}
          />
        ))}
      </ScrollView>

      <T variant="overline" tone="muted" style={{ marginTop: 8 }}>
        {selected ? `Workspaces on ${selected.name}` : 'Workspaces'}
      </T>
      {total === 0 ? (
        <View testID="no-workspaces" style={{ gap: 10 }}>
          <T variant="small" tone="muted">
            No workspaces yet. Allow a project folder on your PC, then start a chat in it here:
          </T>
          <TerminalGuide
            steps={[
              {
                command: String.raw`pocket-agent projects add C:\work\my-app`,
                output: String.raw`Allowed: C:\work\my-app`,
              },
            ]}
          />
        </View>
      ) : (
        <View style={{ marginHorizontal: -4 }}>
          {shown.map((d, di) =>
            d.projects.length === 0 ? null : (
              <View key={d.id} style={{ marginBottom: 6 }}>
                {!selected && devices.length > 1 && (
                  <T variant="caption" tone="muted" style={{ marginLeft: 4, marginBottom: 2 }}>
                    {d.name}
                  </T>
                )}
                {d.projects.map((p, pi) => (
                  <FolderRow
                    key={p.path}
                    folder={p}
                    index={starts[di]! + pi}
                    hint="Shows the folders inside it, or opens it in a new chat"
                    onPress={() => browse(d, p)}
                  />
                ))}
              </View>
            ),
          )}
        </View>
      )}
      <NewChatSheet open={!!browsing} start={browsing ?? undefined} onClose={() => setBrowsing(null)} />
    </View>
  );
}
