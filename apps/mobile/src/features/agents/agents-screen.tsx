import { timeAgo, toolTarget } from '@pocket-agent/core';
import type { AgentSessionDto, ApprovalDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { Bot, ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ApprovalCard } from '@/features/approvals/approval-card';
import { APPROVAL_STATUS } from '@/features/approvals/shared';
import { duration, SessionAvatar, SessionStatusBadge } from '@/features/sessions/badges';
import { NewChatSheet } from '@/features/sessions/new-chat-sheet';
import { useApprovals, useSessions } from '@/lib/data';
import { enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Card, Divider, Press, T, tap, toneColor } from '@/ui/core';
import { EmptyState, Notice, Roll, Skeleton } from '@/ui/feedback';
import { Screen } from '@/ui/screen';

/** How long a decided request stays, showing its result, before the list closes over its place. */
const SETTLE_MS = 1400;

const isWorking = (s: AgentSessionDto) =>
  !s.endedAt && (s.status === 'Running' || s.status === 'Starting' || s.status === 'WaitingForPermission');

/** What a working agent is doing, in a line. */
function activity(s: AgentSessionDto): string {
  if (s.currentTask) return s.currentTask;
  switch (s.status) {
    case 'Starting':
      return 'Starting…';
    case 'WaitingForPermission':
      return 'Waiting for your permission';
    case 'WaitingForInput':
      return 'Finished, waiting for your next message';
    case 'Disconnected':
      return 'PC offline';
    default:
      return 'Working…';
  }
}

/** Re-renders every `ms`, so "for 12 min" stays true while the screen is open. */
function useTick(ms: number) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** A section title in the grouped-list style: small caps above its group. */
function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <T variant="overline" tone="muted" accessibilityRole="header">
        {children}
      </T>
      {count !== undefined && (
        <T variant="overline" tone="muted" style={{ opacity: 0.6 }}>
          {count}
        </T>
      )}
    </View>
  );
}

/** One agent: who, what it is doing, where and for how long. Tap opens its chat. */
function AgentRow({ s, onPress }: { s: AgentSessionDto; onPress: () => void }) {
  const { c } = useTheme();
  const working = isWorking(s);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${s.projectName}: ${activity(s)}. Open chat`}
      testID="agent-row"
      onPress={onPress}
      scale={0.99}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <SessionAvatar session={s} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <T variant="subheading" numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>
            {s.projectName}
          </T>
          <T
            variant="caption"
            style={{ fontVariant: ['tabular-nums'], color: working ? c.primary : c.mutedForeground }}
          >
            {working ? duration(s.startedAt, null) : timeAgo(s.lastActivityAt)}
          </T>
        </View>
        <T
          variant="small"
          numberOfLines={2}
          style={{ color: s.currentTask ? alpha(c.foreground, 0.85) : c.mutedForeground }}
        >
          {activity(s)}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <SessionStatusBadge status={s.status} />
          <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {s.deviceName}
          </T>
        </View>
      </View>
      <ChevronRight size={18} color={alpha(c.mutedForeground, 0.6)} strokeWidth={2} />
    </Press>
  );
}

/** A group of rows in one card, split by inset dividers. */
function Group({ children }: { children: ReactNode }) {
  return (
    <Card style={{ overflow: 'hidden' }}>
      {Children.toArray(children).map((child, i) => (
        <Animated.View key={isValidElement(child) ? (child.key ?? i) : i} layout={layout}>
          {i > 0 && <Divider inset={74} />}
          {child}
        </Animated.View>
      ))}
    </Card>
  );
}

/** A decided request in the history: what it was, where, how it ended. */
function RecentRow({ approval: a }: { approval: ApprovalDto }) {
  const { c } = useTheme();
  const s = APPROVAL_STATUS[a.status];
  const label = a.status === 'Pending' && a.decision ? 'Sent to PC' : s.label;
  const color = toneColor(c, s.tone);
  return (
    <View
      testID="approval-history-row"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="mono" numberOfLines={1} style={{ fontSize: 13 }}>
          {toolTarget(a.input) || a.toolName}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1}>
          {a.projectName} · {timeAgo(a.createdAt)}
        </T>
      </View>
      <View
        style={{
          height: 24,
          paddingHorizontal: 9,
          borderRadius: radius.full,
          backgroundColor: s.tone === 'muted' ? c.muted : alpha(color, 0.14),
          justifyContent: 'center',
        }}
      >
        <Roll text={label} variant="captionMedium" color={color} />
      </View>
    </View>
  );
}

/** The decisions already made, folded away until asked for. */
function RecentDecisions({ items }: { items: ApprovalDto[] }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Animated.View layout={layout} style={{ gap: 8 }}>
      <Press
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap();
          setOpen(!open);
        }}
        haptic={false}
        scale={0.99}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 4,
          paddingVertical: 6,
          borderRadius: radius.md,
        }}
        testID="recent-decisions"
      >
        <T variant="overline" tone="muted">
          RECENT DECISIONS
        </T>
        <T variant="overline" tone="muted" style={{ opacity: 0.6 }}>
          {items.length}
        </T>
        <View style={{ flex: 1 }} />
        <ChevronDown
          size={16}
          color={c.mutedForeground}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Press>
      {open && (
        <Animated.View entering={enter.fade} exiting={exit.fade} testID="approval-history">
          <Card>
            {items.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Divider inset={16} />}
                <RecentRow approval={a} />
              </View>
            ))}
          </Card>
        </Animated.View>
      )}
    </Animated.View>
  );
}

/**
 * Every agent that is running, at a glance: what needs you first (permission requests and Claude's
 * questions, decided right here), then the agents working now, then the ones waiting for you.
 * Tap an agent to open its chat.
 */
export function AgentsScreen() {
  const router = useRouter();
  const { c } = useTheme();
  useTick(30_000);
  const sessions = useSessions('active');
  const pending = useApprovals('pending');
  const history = useApprovals('all');
  const [creating, setCreating] = useState(false);
  const [pulling, setPulling] = useState(false);

  // Decided requests stay a moment, showing their result, before the refresh takes them away.
  const [settling, setSettling] = useState<{ approval: ApprovalDto; index: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  const refreshAll = useCallback(
    () => Promise.all([sessions.refresh(), pending.refresh(), history.refresh()]),
    [sessions, pending, history],
  );
  const decided = (a: ApprovalDto, index: number) => {
    setSettling((s) => (s.some((x) => x.approval.id === a.id) ? s : [...s, { approval: a, index }]));
    clearTimeout(timers.current.get(a.id));
    timers.current.set(
      a.id,
      setTimeout(() => {
        setSettling((s) => s.filter((x) => x.approval.id !== a.id));
        void refreshAll();
      }, SETTLE_MS),
    );
  };

  const needs = [...(pending.state.data ?? [])];
  for (const s of settling) {
    if (!needs.some((a) => a.id === s.approval.id))
      needs.splice(Math.min(s.index, needs.length), 0, s.approval);
  }
  const all = [...(sessions.state.data ?? [])]
    .filter((s) => !s.endedAt)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const working = all.filter(isWorking);
  const waiting = all.filter((s) => !isWorking(s));
  const recent = (history.state.data ?? []).filter((a) => a.status !== 'Pending' || a.decision).slice(0, 20);

  const loading = sessions.state.status === 'loading' || pending.state.status === 'loading';
  const empty = !loading && !needs.length && !all.length;
  const summary = loading
    ? undefined
    : [
        working.length ? `${working.length} working` : null,
        needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} you` : null,
        waiting.length ? `${waiting.length} waiting` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing running right now';

  const openChat = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });
  const pull = () => {
    tap();
    setPulling(true);
    void refreshAll().finally(() => setPulling(false));
  };

  let step = 0;
  return (
    <Screen
      title="Agents"
      subtitle={summary}
      onRefresh={pull}
      refreshing={pulling}
      actions={<Button label="New chat" icon={Plus} size="sm" onPress={() => setCreating(true)} />}
      contentStyle={{ paddingHorizontal: 16, gap: 22 }}
    >
      {loading && (
        <Animated.View
          entering={enter.fade}
          exiting={exit.fade}
          accessibilityState={{ busy: true }}
          style={{ gap: 10 }}
        >
          <Skeleton height={14} width={90} />
          <Skeleton height={168} round={radius.xl} />
        </Animated.View>
      )}
      {sessions.state.status === 'error' && <Notice>{sessions.state.error}</Notice>}
      {pending.state.status === 'error' && <Notice>{pending.state.error}</Notice>}

      {needs.length > 0 && (
        <Animated.View entering={enter.rise(step++)} layout={layout} style={{ gap: 10 }} testID="needs-you">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warning }} />
            <T
              variant="overline"
              accessibilityRole="header"
              style={{ color: c.warning, fontFamily: fonts.semibold }}
            >
              NEEDS YOU
            </T>
            <T variant="overline" style={{ color: c.warning, opacity: 0.6 }}>
              {needs.length}
            </T>
          </View>
          {needs.map((a, i) => (
            <Animated.View key={a.id} entering={enter.rise(i)} exiting={exit.fade} layout={layout}>
              <ApprovalCard approval={a} onDecided={() => decided(a, i)} />
            </Animated.View>
          ))}
        </Animated.View>
      )}

      {working.length > 0 && (
        <Animated.View
          entering={enter.rise(step++)}
          layout={layout}
          style={{ gap: 8 }}
          testID="agents-working"
        >
          <SectionTitle count={working.length}>WORKING</SectionTitle>
          <Group>
            {working.map((s) => (
              <AgentRow key={s.id} s={s} onPress={() => openChat(s.id)} />
            ))}
          </Group>
        </Animated.View>
      )}

      {waiting.length > 0 && (
        <Animated.View
          entering={enter.rise(step++)}
          layout={layout}
          style={{ gap: 8 }}
          testID="agents-waiting"
        >
          <SectionTitle count={waiting.length}>WAITING FOR YOU</SectionTitle>
          <Group>
            {waiting.map((s) => (
              <AgentRow key={s.id} s={s} onPress={() => openChat(s.id)} />
            ))}
          </Group>
        </Animated.View>
      )}

      {empty && (
        <View testID="no-agents">
          <EmptyState
            icon={Bot}
            title="No agents running"
            body="Start Claude on your PC from here, or in your editor. Running agents and anything that needs you show up on this tab."
            action="New chat"
            onAction={() => setCreating(true)}
          />
        </View>
      )}

      {!loading && <RecentDecisions items={recent} />}

      <NewChatSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}
