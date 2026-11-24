import { timeAgo, toolTarget } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { Bot, ChevronDown, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ApprovalCard } from '@/features/approvals/approval-card';
import { APPROVAL_STATUS } from '@/features/approvals/shared';
import { NewChatSheet } from '@/features/sessions/new-chat-sheet';
import { useApprovals, useWorkers } from '@/lib/data';
import { AgentMap } from './agent-map';
import { enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Card, Divider, Press, T, tap, toneColor } from '@/ui/core';
import { EmptyState, Notice, Roll, Skeleton } from '@/ui/feedback';
import { Screen } from '@/ui/screen';

/** How long a decided request stays, showing its result, before the list closes over its place. */
const SETTLE_MS = 1400;

/** Re-renders every `ms`, so "for 12 min" stays true while the screen is open. */
function useTick(ms: number) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
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
 * The agents working for you behind your chats: what needs you first (permission requests and
 * Claude's questions, decided right here), then the background workers (sub-agents and workflows a
 * chat started) running now, then the ones that finished in the last 24 hours. Chats themselves live
 * on the Chats tab. Tap a worker to open the chat it runs in.
 */
export function AgentsScreen() {
  const { c } = useTheme();
  useTick(30_000);
  const workers = useWorkers();
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
    () => Promise.all([workers.refresh(), pending.refresh(), history.refresh()]),
    [workers, pending, history],
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
  const list = workers.state.data ?? [];
  const running = list.filter((w) => w.status === 'running');
  const finished = list.filter((w) => w.status !== 'running');
  const recent = (history.state.data ?? []).filter((a) => a.status !== 'Pending' || a.decision).slice(0, 20);

  const loading = workers.state.status === 'loading' || pending.state.status === 'loading';
  const empty = !loading && !needs.length && !list.length;
  const summary = loading
    ? undefined
    : [
        running.length ? `${running.length} running` : null,
        needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} you` : null,
        finished.length ? `${finished.length} finished today` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing running right now';

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
      {workers.state.status === 'error' && <Notice>{workers.state.error}</Notice>}
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

      {list.length > 0 && (
        <Animated.View entering={enter.rise(step++)} layout={layout}>
          <AgentMap workers={list} />
        </Animated.View>
      )}

      {empty && (
        <View testID="no-agents">
          <EmptyState
            icon={Bot}
            title="No background agents"
            body="When a chat sends sub-agents or a workflow to work in the background, they show up here while they run and for a day after they finish. Anything that needs you shows up here too."
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
