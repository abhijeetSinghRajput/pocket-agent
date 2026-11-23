import { recentSections, timeAgo } from '@pocket-agent/core';
import { NotificationPage, type NotificationDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { BellOff, ChevronDown } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { apiRequest } from '@/lib/api';
import { markRead, useNotifications } from '@/lib/data';
import { routeForLink } from '@/lib/links';
import { exit, layout } from '@/lib/motion';
import { fonts, useTheme } from '@/lib/theme';
import { useArrivals } from '@/ui/arrive';
import { Badge, Button, buzz, Card, Divider, Dot, Fade, Press, T } from '@/ui/core';
import { EmptyState, Notice, Skeleton } from '@/ui/feedback';
import { Screen } from '@/ui/screen';

const CATEGORY_LABEL: Record<string, string> = {
  permission_required: 'Permission',
  agent_failed: 'Failed',
  device_disconnected: 'PC offline',
  task_completed: 'Finished',
  agent_started: 'Started',
  test: 'Test',
};

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
  const body = (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ width: 8, marginTop: 6 }}>
        <Fade visible={unread}>
          <Dot color={c.primary} size={8} />
        </Fade>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 4 }}>
          <T
            variant="smallMedium"
            style={{ fontFamily: unread ? fonts.semibold : fonts.medium, flexShrink: 1 }}
          >
            {n.title}
          </T>
          <Badge
            label={CATEGORY_LABEL[n.category] ?? n.category}
            tone={n.priority === 'critical' ? 'warning' : 'muted'}
          />
        </View>
        <T variant="small" tone="muted" style={{ marginTop: 2 }}>
          {n.body}
        </T>
        <T variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {timeAgo(n.createdAt)}
          {note && ` · ${note}`}
        </T>
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
      accessibilityLabel={`${n.title}. ${n.body}`}
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
      contentStyle={{ paddingHorizontal: 20, gap: 20 }}
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
                {i > 0 && <Divider />}
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
