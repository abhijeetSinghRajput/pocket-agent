import { recentSections, timeAgo } from '@pocket-agent/core';
import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import {
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MonitorOff,
  Play,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { apiRequest } from '@/lib/api';
import { markRead, useNotifications } from '@/lib/data';
import { routeForLink } from '@/lib/links';
import { enter, exit, layout, settleSpring, timing } from '@/lib/motion';
import { alpha, fonts, useTheme } from '@/lib/theme';
import { useArrivals } from '@/ui/arrive';
import { Button, buzz, IconTile, Press, T, type Tone } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Segmented } from '@/ui/form';
import { Screen, TAB_BAR_HEIGHT } from '@/ui/screen';

/** What each kind of alert looks like: an icon in the tone of what happened. */
const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  permission_required: { icon: ShieldAlert, tone: 'warning' },
  agent_failed: { icon: CircleAlert, tone: 'danger' },
  device_disconnected: { icon: MonitorOff, tone: 'muted' },
  task_completed: { icon: CircleCheck, tone: 'success' },
  agent_started: { icon: Play, tone: 'primary' },
  test: { icon: Bell, tone: 'muted' },
};
const DEFAULT_LOOK = { icon: Bell, tone: 'muted' as Tone };

type Tab = 'unread' | 'all';
const TABS: { value: Tab; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'all', label: 'All' },
];

/** "now", "5m", "2h", "3d": how long ago, as short as a phone's notification shade says it. */
function shortAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

function pushNote(n: NotificationDto): string | null {
  if (n.push.sent > 0) return null;
  switch (n.push.skipped) {
    case 'quiet_hours':
      return 'Not pushed (quiet hours)';
    case 'no_browser_registered':
      return 'Not pushed (no browser enabled)';
    case 'push_not_configured':
      return null; // stated once in Settings, not on every row
    case 'send_failed':
      return 'Push delivery failed';
    default:
      return null;
  }
}

/**
 * One notification as a full-width row. Unread ones sit on a light wash of the accent, which eases
 * out when they are read (no dot).
 */
function Row({
  n,
  unread,
  divider,
  onOpen,
}: {
  n: NotificationDto;
  unread: boolean;
  divider: boolean;
  onOpen: (n: NotificationDto) => void;
}) {
  const { c } = useTheme();
  const note = pushNote(n);
  const look = LOOK[n.category] ?? DEFAULT_LOOK;
  const wash = useSharedValue(unread ? 1 : 0);
  useEffect(() => {
    wash.set(timing.quick(unread ? 1 : 0));
  }, [unread, wash]);
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 14,
      }}
    >
      <IconTile icon={look.icon} size={40} tone={look.tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <T
            variant="smallMedium"
            numberOfLines={1}
            style={{ flex: 1, fontFamily: unread ? fonts.semibold : fonts.medium }}
          >
            {n.title}
          </T>
          <T
            variant="caption"
            accessibilityLabel={timeAgo(n.createdAt)}
            style={{ fontVariant: ['tabular-nums'], color: unread ? c.primary : c.mutedForeground }}
          >
            {shortAgo(n.createdAt)}
          </T>
        </View>
        <T
          variant="small"
          numberOfLines={2}
          style={{ marginTop: 1, color: unread ? c.foreground : c.mutedForeground }}
        >
          {n.body}
        </T>
        {note && (
          <T variant="caption" tone="muted" style={{ marginTop: 3 }}>
            {note}
          </T>
        )}
      </View>
    </View>
  );
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: alpha(c.primary, 0.1) }, washStyle]}
      />
      {divider && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 74,
            right: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: c.border,
          }}
        />
      )}
      {n.link ? (
        <Press
          accessibilityRole="button"
          accessibilityLabel={`${unread ? 'Unread. ' : ''}${n.title}. ${n.body}. ${timeAgo(n.createdAt)}`}
          accessibilityState={{ selected: unread }}
          testID="notification"
          onPress={() => onOpen(n)}
          scale={0.99}
        >
          {body}
        </Press>
      ) : (
        <View testID="notification" accessibilityState={{ selected: unread }}>
          {body}
        </View>
      )}
    </View>
  );
}

type Item =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'row'; key: string; n: NotificationDto; divider: boolean };

/** Day headers and rows, flattened for one FlatList. */
function flatten(sections: { label: string; items: NotificationDto[] }[]): Item[] {
  const out: Item[] = [];
  for (const s of sections) {
    out.push({ kind: 'header', key: `h:${s.label}`, label: s.label });
    s.items.forEach((n, i) => out.push({ kind: 'row', key: n.id, n, divider: i > 0 }));
  }
  return out;
}

/** One page: the unread notifications, or all of them, by day. */
function AlertsPage({
  tab,
  width,
  items,
  readNow,
  status,
  more,
  loadingMore,
  onMore,
  onOpen,
  onRefresh,
}: {
  tab: Tab;
  width: number;
  items: NotificationDto[];
  /** Read here but not yet refreshed from the server. */
  readNow: ReadonlySet<string>;
  status: 'loading' | 'ready' | 'error';
  more: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onOpen: (n: NotificationDto) => void;
  onRefresh: () => Promise<void>;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  // All: older than a week stays folded away until asked for. Unread: everything unread shows.
  const [showEarlier, setShowEarlier] = useState(false);

  const { data, hidden } = useMemo(() => {
    const list = tab === 'unread' ? items.filter((n) => !n.readAt) : items;
    const { sections, earlier } = recentSections(list);
    const open = tab === 'unread' || showEarlier;
    return {
      data: flatten([...sections, ...(open && earlier.length ? [{ label: 'Earlier', items: earlier }] : [])]),
      hidden: open ? 0 : earlier.length,
    };
  }, [items, tab, showEarlier]);

  const ids = useMemo(() => (status === 'ready' ? data.map((d) => d.key) : null), [status, data]);
  const arriving = useArrivals(ids);

  async function pull() {
    setPulling(true);
    try {
      await onRefresh();
    } finally {
      setPulling(false);
    }
  }

  let empty: React.JSX.Element | undefined;
  if (status === 'loading') {
    empty = (
      <View accessibilityState={{ busy: true }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingVertical: 14 }}>
            <Skeleton width={40} height={40} round={12} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width={160} height={14} />
              <Skeleton width="80%" height={12} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (status === 'ready' && tab === 'unread') {
    empty = (
      <View testID="no-unread-notifications">
        <EmptyState
          icon={CheckCheck}
          title="You're all caught up"
          body="New permission requests, failures and finished turns show up here."
        />
      </View>
    );
  } else if (status === 'ready') {
    empty = (
      <View testID="no-notifications">
        <EmptyState icon={BellOff} title="No notifications yet">
          <T variant="small" tone="muted" center>
            Permission requests, failures and finished turns show up here. Choose which in{' '}
            <T
              variant="smallMedium"
              accessibilityRole="link"
              style={{ textDecorationLine: 'underline' }}
              onPress={() => router.push('/profile')}
            >
              your profile
            </T>
            .
          </T>
        </EmptyState>
      </View>
    );
  }

  const canMore = data.length > 0 && (hidden > 0 || more);

  return (
    <Animated.FlatList
      data={data}
      keyExtractor={(d) => d.key}
      itemLayoutAnimation={layout}
      renderItem={({ item, index }) => (
        <Animated.View entering={arriving(item.key, index)} exiting={exit.fade}>
          {item.kind === 'header' ? (
            <T
              variant="overline"
              tone="muted"
              accessibilityRole="header"
              testID="notification-section"
              style={{
                paddingHorizontal: 20,
                paddingTop: index ? 18 : 4,
                paddingBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              {item.label}
            </T>
          ) : (
            <Row
              n={item.n}
              unread={!item.n.readAt && !readNow.has(item.n.id)}
              divider={item.divider}
              onOpen={onOpen}
            />
          )}
        </Animated.View>
      )}
      ListEmptyComponent={empty}
      ListFooterComponent={
        canMore ? (
          <View style={{ alignItems: 'center', paddingTop: 12 }}>
            <Button
              label={loadingMore ? 'Loading…' : 'Show more'}
              icon={ChevronDown}
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onPress={() => (hidden > 0 ? setShowEarlier(true) : onMore())}
              testID="show-more"
            />
          </View>
        ) : undefined
      }
      accessibilityLabel={tab === 'unread' ? 'Unread notifications' : 'All notifications'}
      testID={`notifications-${tab}`}
      showsVerticalScrollIndicator={false}
      style={{ width }}
      contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => void pull()}
          tintColor={c.primary}
          colors={[c.primary]}
          progressBackgroundColor={c.card}
        />
      }
    />
  );
}

/**
 * Notification history, newest first, by day, as the phone's own notification list draws it: flat
 * rows, unread ones on a light wash. Unread and All are two pages side by side: swipe between them,
 * or tap the control. Tapping a notification marks it read and opens what it is about.
 */
export function AlertsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { state, refresh } = useNotifications(30);
  const [older, setOlder] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(new Set());
  const [tab, setTab] = useState<Tab>('unread');

  const first = state.data;
  const next = cursor === undefined ? (first?.nextCursor ?? null) : cursor;
  const items = useMemo(
    () => [
      ...(first?.notifications ?? []),
      ...older.filter((o) => !first?.notifications.some((f) => f.id === o.id)),
    ],
    [first, older],
  );

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await apiRequest(`/notifications?limit=30&before=${next}`, NotificationPage);
      setOlder((o) => [...o, ...page.notifications]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const open = (n: NotificationDto) => {
    if (!n.readAt) {
      setReadNow((s) => new Set(s).add(n.id));
      void markRead({ ids: [n.id] }).then(refresh, () => undefined);
    }
    if (n.link) router.push(routeForLink(n.link));
  };

  async function markAll() {
    setError(null);
    const unread = items.filter((n) => !n.readAt).map((n) => n.id);
    setReadNow((s) => new Set([...s, ...unread]));
    try {
      await markRead();
      setOlder((o) => o.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      await refresh();
      buzz(true);
    } catch (err) {
      setReadNow((s) => new Set([...s].filter((id) => !unread.includes(id))));
      setError((err as Error).message);
      buzz(false);
    }
  }

  const index = TABS.findIndex((o) => o.value === tab);
  // Where the strip of pages sits (0 = Unread, -width = All) and which page it is settled on.
  const x = useSharedValue(0);
  const page = useSharedValue(0);
  useEffect(() => {
    page.set(index);
    x.set(withSpring(-index * width, settleSpring));
  }, [index, width, x, page]);

  const pan = usePanGesture({
    activeOffsetX: [-16, 16],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      const rest = -page.get() * width;
      let to = rest + e.translationX;
      // Past either end the strip only gives a little.
      if (to > 0) to *= 0.25;
      else if (to < -width) to = -width + (to + width) * 0.25;
      x.set(to);
    },
    onDeactivate: (e) => {
      'worklet';
      const from = page.get();
      const step =
        e.translationX < -width * 0.3 || e.velocityX < -600
          ? 1
          : e.translationX > width * 0.3 || e.velocityX > 600
            ? -1
            : 0;
      const to = Math.min(TABS.length - 1, Math.max(0, from + step));
      page.set(to);
      x.set(withSpring(-to * width, { ...settleSpring, velocity: e.velocityX }));
      if (to !== from) scheduleOnRN(setTab, TABS[to]!.value);
    },
  });
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const unreadCount = first ? items.filter((n) => !n.readAt && !readNow.has(n.id)).length : 0;
  const status = state.status === 'loading' ? 'loading' : first ? 'ready' : 'error';

  return (
    <Screen
      title="Alerts"
      scroll={false}
      actions={
        first && first.unread > 0 && unreadCount > 0 ? (
          <Animated.View entering={enter.fade} exiting={exit.fade}>
            <Button
              label="Mark all read"
              variant="outline"
              size="sm"
              onPress={() => void markAll()}
              testID="mark-all-read"
            />
          </Animated.View>
        ) : undefined
      }
    >
      <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
        <Segmented options={TABS} value={tab} onChange={setTab} label="Which notifications" />
        {(error || state.error) && <Notice>{error ?? state.error}</Notice>}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1, flexDirection: 'row', width: width * TABS.length }, strip]}>
          {TABS.map((o) => (
            <AlertsPage
              key={o.value}
              tab={o.value}
              width={width}
              items={items}
              readNow={readNow}
              status={status}
              more={!!next}
              loadingMore={loadingMore}
              onMore={() => void showMore()}
              onOpen={open}
              onRefresh={refresh}
            />
          ))}
        </Animated.View>
      </GestureDetector>
    </Screen>
  );
}
