import { recentSections, timeAgo } from '@pocket-agent/core';
import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import {
  Bell,
  BellOff,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  MonitorOff,
  Play,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { apiRequest } from '@/lib/api';
import { markRead, useNotifications } from '@/lib/data';
import { routeForLink } from '@/lib/links';
import { exit, layout } from '@/lib/motion';
import { fonts, radius, useTheme } from '@/lib/theme';
import { useArrivals } from '@/ui/arrive';
import { Button, buzz, Card, Divider, Dot, Fade, IconTile, Press, T, type Tone } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Screen } from '@/ui/screen';

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

function Row({ n, onOpen }: { n: NotificationDto; onOpen: (n: NotificationDto) => void }) {
  const { c } = useTheme();
  const unread = !n.readAt;
  const note = pushNote(n);
  const look = LOOK[n.category] ?? DEFAULT_LOOK;
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <View>
        <IconTile icon={look.icon} size={40} tone={look.tone} />
        {/* Unread: a dot on the tile's corner, ringed in the card so it reads as sitting on it. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            padding: 2,
            borderRadius: radius.full,
            backgroundColor: c.card,
          }}
        >
          <Fade visible={unread}>
            <Dot color={c.primary} size={8} />
          </Fade>
        </View>
      </View>
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
  if (!n.link) {
    return (
      <View testID="notification" accessibilityState={{ selected: unread }}>
        {body}
      </View>
    );
  }
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${n.title}. ${n.body}. ${timeAgo(n.createdAt)}`}
      testID="notification"
      onPress={() => onOpen(n)}
      scale={0.99}
    >
      {body}
    </Press>
  );
}

/** Notification history, newest first, by day. Tapping one marks it read and opens what it is about. */
export function AlertsScreen() {
  const router = useRouter();
  const { state, refresh } = useNotifications(30);
  const [older, setOlder] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const first = state.data;
  const next = cursor === undefined ? (first?.nextCursor ?? null) : cursor;
  const items = useMemo(
    () => [
      ...(first?.notifications ?? []),
      ...older.filter((o) => !first?.notifications.some((f) => f.id === o.id)),
    ],
    [first, older],
  );

  // Today, Yesterday, Last 7 days; anything earlier only after "Show more".
  const [showEarlier, setShowEarlier] = useState(false);
  const [loading, setLoading] = useState(false);
  const { shown, hidden } = useMemo(() => {
    const { sections, earlier } = recentSections(items);
    const all: { label: string; items: NotificationDto[] }[] = [
      ...sections,
      ...(showEarlier && earlier.length ? [{ label: 'Earlier', items: earlier }] : []),
    ];
    return { shown: all, hidden: showEarlier ? 0 : earlier.length };
  }, [items, showEarlier]);

  const ids = useMemo(() => (first ? shown.flatMap((s) => s.items.map((n) => n.id)) : null), [first, shown]);
  const arriving = useArrivals(ids);

  async function showMore() {
    // First what is already here but folded away; after that, older pages from the server.
    if (hidden > 0) return setShowEarlier(true);
    if (!next) return;
    setLoading(true);
    try {
      const page = await apiRequest(`/notifications?limit=30&before=${next}`, NotificationPage);
      setOlder((o) => [...o, ...page.notifications]);
      setCursor(page.nextCursor);
      setShowEarlier(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const open = (n: NotificationDto) => {
    if (!n.readAt) void markRead({ ids: [n.id] }).then(refresh, () => undefined);
    router.push(routeForLink(n.link));
  };

  async function markAll() {
    setError(null);
    try {
      await markRead();
      setOlder((o) => o.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      await refresh();
      buzz(true);
    } catch (err) {
      setError((err as Error).message);
      buzz(false);
    }
  }

  async function pull() {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }

  let row = 0;
  return (
    <Screen
      title="Alerts"
      onRefresh={() => void pull()}
      refreshing={pulling}
      actions={
        first && first.unread > 0 ? (
          <Animated.View entering={arriving('mark-all', 0)} exiting={exit.fade}>
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
      contentStyle={{ paddingHorizontal: 16, gap: 18 }}
    >
      {(error || state.error) && <Notice>{error ?? state.error}</Notice>}
      {state.status === 'loading' && <Skeleton height={160} round={18} />}
      {state.status === 'ready' && items.length === 0 && (
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
      )}
      {shown.map((section) => (
        <Animated.View
          key={section.label}
          layout={layout}
          accessibilityLabel={section.label}
          testID="notification-section"
          style={{ gap: 6 }}
        >
          <T variant="overline" tone="muted" style={{ paddingHorizontal: 4, textTransform: 'uppercase' }}>
            {section.label}
          </T>
          <Card style={{ overflow: 'hidden' }}>
            {section.items.map((n, i) => (
              <Animated.View key={n.id} entering={arriving(n.id, row++)} layout={layout}>
                {i > 0 && <Divider inset={66} />}
                <Row n={n} onOpen={open} />
              </Animated.View>
            ))}
          </Card>
        </Animated.View>
      ))}
      {/* Older than a week stays folded away until asked for. */}
      {(hidden > 0 || next) && (
        <Animated.View layout={layout} style={{ alignItems: 'center' }}>
          <Button
            label={loading ? 'Loading…' : 'Show more'}
            icon={ChevronDown}
            variant="ghost"
            size="sm"
            disabled={loading}
            onPress={() => void showMore()}
            testID="show-more"
          />
        </Animated.View>
      )}
    </Screen>
  );
}
