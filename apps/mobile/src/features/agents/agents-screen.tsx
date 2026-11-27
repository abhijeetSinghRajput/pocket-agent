import { requestTarget, timeAgo } from '@pocket-agent/core';
import type { ApprovalDto } from '@pocket-agent/protocol';
import { Bot, ChevronDown, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AllowAllButton, allowable } from '@/features/approvals/allow-all';
import { ApprovalCard } from '@/features/approvals/approval-card';
import { APPROVAL_STATUS } from '@/features/approvals/shared';
import { NewChatSheet } from '@/features/sessions/new-chat-sheet';
import { useApprovals, useDevices, useWorkers } from '@/lib/data';
import { AgentMap } from './agent-map';
import { ConnectedAgents } from './connected-agents';
import { enter, exit, layout } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Card, Divider, Press, T, tap, toneColor } from '@/ui/core';
import { EmptyState, Notice, Roll, Skeleton } from '@/ui/feedback';
import { Segmented } from '@/ui/form';
import { SwipePages } from '@/ui/pages';
import { Screen, TAB_BAR_HEIGHT } from '@/ui/screen';

type Page = 'active' | 'finished' | 'connected';
// The agents you have come first; then the sub-agents your chats run, and the ones that finished.
const PAGES: readonly Page[] = ['connected', 'active', 'finished'];

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
          {requestTarget(a.toolName, a.input) || a.toolName}
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
  const devices = useDevices();
  const [creating, setCreating] = useState(false);
  // Running agents first; the ones that finished (and decisions made) are a tab away.
  const [tab, setTab] = useState<Page>('connected');
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);

  // Decided requests stay a moment, showing their result, before the refresh takes them away.
  const [settling, setSettling] = useState<{ approval: ApprovalDto; index: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  const refreshAll = useCallback(
    () => Promise.all([workers.refresh(), pending.refresh(), history.refresh(), devices.refresh()]),
    [workers, pending, history, devices],
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

  const loadingView = loading && (
    <Animated.View
      entering={enter.fade}
      exiting={exit.fade}
      accessibilityState={{ busy: true }}
      style={{ gap: 10 }}
    >
      <Skeleton height={14} width={90} />
      <Skeleton height={168} round={radius.xl} />
    </Animated.View>
  );
  const errors = (
    <>
      {workers.state.status === 'error' && <Notice>{workers.state.error}</Notice>}
      {pending.state.status === 'error' && <Notice>{pending.state.error}</Notice>}
    </>
  );

  /** What runs now, and what needs you. */
  const activePage = (
    <>
      {loadingView}
      {errors}
      {needs.length > 0 && (
        <Animated.View entering={enter.rise(0)} layout={layout} style={{ gap: 10 }} testID="needs-you">
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
            <View style={{ flex: 1 }} />
            <AllowAllButton requests={allowable(needs)} onDone={() => void refreshAll()} />
          </View>
          {needs.map((a, i) => (
            <Animated.View key={a.id} entering={enter.rise(i)} exiting={exit.fade} layout={layout}>
              <ApprovalCard approval={a} onDecided={() => decided(a, i)} />
            </Animated.View>
          ))}
        </Animated.View>
      )}
      {!loading && running.length > 0 && (
        <Animated.View entering={enter.rise(1)} layout={layout}>
          <AgentMap workers={running} />
        </Animated.View>
      )}
      {!loading && !running.length && !needs.length && (
        <View testID="no-agents">
          <EmptyState
            icon={Bot}
            title="Nothing running"
            body={
              finished.length
                ? 'Sub-agents and workflows your chats start show up here while they run. The ones that finished today are under Finished.'
                : 'When a chat sends sub-agents or a workflow to work, they show up here while they run. Anything that needs you shows up here too.'
            }
            action="New chat"
            onAction={() => setCreating(true)}
          />
        </View>
      )}
    </>
  );

  /** What finished today, and the decisions made. */
  const finishedPage = (
    <>
      {loadingView}
      {errors}
      {!loading && finished.length > 0 && (
        <Animated.View entering={enter.rise(0)} layout={layout}>
          <AgentMap workers={finished} />
        </Animated.View>
      )}
      {!loading && !finished.length && (
        <View testID="no-finished-agents">
          <EmptyState
            icon={Bot}
            title="Nothing finished today"
            body="Agents that finish stay here for a day."
          />
        </View>
      )}
      {!loading && <RecentDecisions items={recent} />}
    </>
  );

  return (
    <Screen
      title="Agents"
      subtitle={summary}
      scroll={false}
      actions={<Button label="New chat" icon={Plus} size="sm" onPress={() => setCreating(true)} />}
      // The tabs stay at the top with the title; each page scrolls under them, and they swipe.
      pinned={
        <Segmented
          options={[
            { value: 'connected', label: 'Connected' },
            { value: 'active', label: running.length ? `Sub-agents · ${running.length}` : 'Sub-agents' },
            { value: 'finished', label: finished.length ? `Finished · ${finished.length}` : 'Finished' },
          ]}
          value={tab}
          onChange={setTab}
          label="Which agents"
        />
      }
    >
      <SwipePages pages={PAGES} value={tab} onChange={setTab}>
        {(page, width) => (
          <ScrollView
            style={{ width }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 4,
              paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 24,
              gap: 22,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={pull}
                tintColor={c.primary}
                colors={[c.primary]}
                progressBackgroundColor={c.card}
              />
            }
            testID={`agents-${page}`}
          >
            {page === 'active' ? (
              activePage
            ) : page === 'finished' ? (
              finishedPage
            ) : (
              <ConnectedAgents
                devices={devices.state.data}
                loading={devices.state.status === 'loading'}
                error={devices.state.status === 'error' ? devices.state.error : null}
              />
            )}
          </ScrollView>
        )}
      </SwipePages>
      <NewChatSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}
