import { Tabs } from 'expo-router';
import { Bell, Bot, MessageCircle, MonitorSmartphone, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/lib/auth';
import { useApprovals, useNotifications, useWorkers } from '@/lib/data';
import { dur, ease, enter, settleSpring } from '@/lib/motion';
import { alpha, fonts, useTheme } from '@/lib/theme';
import { useUpdateWaiting } from '@/features/shell/app-update';
import { Avatar, CountBubble, Dot, T, tap } from '@/ui/core';
import { TAB_BAR_HEIGHT } from '@/ui/screen';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon?: LucideIcon }> = {
  index: { label: 'Chats', icon: MessageCircle },
  agents: { label: 'Agents', icon: Bot },
  alerts: { label: 'Alerts', icon: Bell },
  devices: { label: 'Devices', icon: MonitorSmartphone },
  profile: { label: 'Profile' },
};

/**
 * The bottom bar: four sections and your avatar. A soft pill slides (on a spring) to the section
 * you are in; counts sit on Agents (requests waiting for you) and Alerts (unread).
 */
export function TabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const waiting = useApprovals('pending').state.data?.length ?? 0;
  const unread = useNotifications().state.data?.unread ?? 0;
  // Any agent at work right now: a green dot breathes on Agents.
  const active = (useWorkers().state.data ?? []).some((w) => w.status === 'running');
  const updateWaiting = useUpdateWaiting();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const slot = width / count;
  const x = useSharedValue(0);
  useEffect(() => {
    x.set(withSpring(state.index * slot, settleSpring));
  }, [state.index, slot, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom,
        backgroundColor: c.bar,
        borderTopWidth: 1,
        borderTopColor: c.border,
      }}
    >
      <View
        accessibilityRole="tablist"
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', height: TAB_BAR_HEIGHT }}
      >
        {slot > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', top: 8, left: 0, width: slot, alignItems: 'center' }, pill]}
          >
            <View
              style={{ width: 58, height: 32, borderRadius: 16, backgroundColor: alpha(c.primary, 0.14) }}
            />
          </Animated.View>
        )}
        {state.routes.map((route, i) => {
          const tab = TABS[route.name] ?? { label: route.name };
          const focused = state.index === i;
          const badge = route.name === 'agents' ? waiting : route.name === 'alerts' ? unread : 0;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={[
                tab.label,
                badge ? `${badge} waiting` : null,
                route.name === 'agents' && active ? 'agents at work' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              testID={`tab-${route.name}`}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  tap();
                  navigateToTab(route.key);
                }
              }}
              style={{ flex: 1, alignItems: 'center', paddingTop: 8, gap: 4 }}
            >
              <View style={{ height: 32, alignItems: 'center', justifyContent: 'center' }}>
                {tab.icon ? (
                  <TabIcon icon={tab.icon} focused={focused} />
                ) : (
                  <View
                    style={{
                      padding: 2,
                      borderRadius: 16,
                      borderWidth: 2,
                      borderColor: focused ? c.primary : 'transparent',
                    }}
                  >
                    <Avatar name={user.name} url={user.avatarUrl} size={24} />
                    {updateWaiting && (
                      // An update is waiting (in Profile): a red dot on the avatar's corner.
                      <Animated.View
                        entering={enter.pop}
                        pointerEvents="none"
                        testID="update-dot"
                        style={{
                          position: 'absolute',
                          top: -1,
                          right: -1,
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: c.destructive,
                          borderWidth: 2,
                          borderColor: c.bar,
                        }}
                      />
                    )}
                  </View>
                )}
                {route.name === 'agents' && active && (
                  // On the icon's lower-right corner (the count keeps the upper one), ringed by the bar.
                  <Animated.View
                    entering={enter.pop}
                    pointerEvents="none"
                    testID="agents-active-dot"
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      left: 13,
                      padding: 2,
                      borderRadius: 7,
                      backgroundColor: c.bar,
                    }}
                  >
                    <Dot color={c.success} size={9} pulse />
                  </Animated.View>
                )}
                {badge > 0 && (
                  // On the icon's top-right corner, with a ring of the bar so it reads as sitting on it.
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 1,
                      left: 12,
                      padding: 2,
                      borderRadius: 11,
                      backgroundColor: c.bar,
                    }}
                  >
                    <CountBubble count={badge} />
                  </View>
                )}
              </View>
              <T
                variant="caption"
                style={{
                  fontFamily: focused ? fonts.semibold : fonts.medium,
                  fontSize: 11,
                  lineHeight: 14,
                  color: focused ? c.primary : c.mutedForeground,
                }}
              >
                {tab.label}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TabIcon({ icon: Icon, focused }: { icon: LucideIcon; focused: boolean }) {
  const { c } = useTheme();
  const lift = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    lift.set(withTiming(focused ? 1 : 0, { duration: dur.quick, easing: ease.out }));
  }, [focused, lift]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * lift.value }] }));
  // Duotone: the outline in one tone, the inside in a soft wash of the same tone.
  const tone = focused ? c.primary : c.mutedForeground;
  return (
    <Animated.View style={style}>
      <Icon
        size={21}
        color={tone}
        fill={alpha(tone, focused ? 0.24 : 0.14)}
        strokeWidth={focused ? 2.3 : 2}
      />
    </Animated.View>
  );
}
