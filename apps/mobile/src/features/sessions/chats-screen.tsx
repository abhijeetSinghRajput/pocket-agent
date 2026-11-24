import { chatListTime } from '@pocket-agent/core';
import type { AgentSessionDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { SessionAvatar, SessionKindBadge, SessionStatusBadge } from '@/features/sessions/badges';
import { NewChatSheet } from '@/features/sessions/new-chat-sheet';
import { Workspaces } from '@/features/sessions/workspaces';
import { useApprovals, useDevices, useSessions } from '@/lib/data';
import { useDrafts, type Draft } from '@/lib/drafts';
import { exit, layout, settleSpring } from '@/lib/motion';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';
import { useArrivals } from '@/ui/arrive';
import { Button, Press, T } from '@/ui/core';
import { Notice, Skeleton } from '@/ui/feedback';
import { Segmented } from '@/ui/form';
import { Screen, TAB_BAR_HEIGHT } from '@/ui/screen';
import { SearchField } from '@/ui/search';
import { TerminalGuide } from '@/ui/terminal-guide';

const PREVIEW: Partial<Record<AgentSessionDto['status'], string>> = {
  Starting: 'Starting…',
  Running: 'Working…',
  WaitingForInput: 'Waiting for your next message',
  WaitingForPermission: 'Needs permission',
  Disconnected: 'PC offline',
};

function preview(s: AgentSessionDto): string {
  return s.currentTask || (s.endedAt ? 'Session ended' : (PREVIEW[s.status] ?? ''));
}

/** What a draft says in the list: its text, or what is attached when there is no text. */
function draftText(d: Draft): string {
  const text = d.text
    .trim()
    .split(/\s*\n\s*/)
    .join(' ');
  if (text) return text;
  const n = d.files.length;
  return n === 1 ? (d.files[0]!.file.mime.startsWith('image/') ? 'Photo' : '1 file') : `${n} files`;
}

function SessionRow({
  s,
  waiting,
  draft,
  onPress,
}: {
  s: AgentSessionDto;
  waiting: number;
  draft?: Draft;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const busy = !s.endedAt && (s.status === 'Running' || s.status === 'WaitingForPermission');
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${s.projectName}, ${preview(s)}`}
      testID="session-card"
      onPress={onPress}
      scale={0.98}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: radius.xl,
      }}
    >
      <SessionAvatar session={s} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <T variant="subheading" style={{ flex: 1, fontSize: 15, lineHeight: 21 }} numberOfLines={1}>
            {s.projectName}
          </T>
          <T
            variant={waiting ? 'captionMedium' : 'caption'}
            style={{
              fontVariant: ['tabular-nums'],
              color: waiting ? c.warning : busy ? c.primary : c.mutedForeground,
            }}
          >
            {chatListTime(s.lastActivityAt)}
          </T>
        </View>
        <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {draft ? (
            // An unsent message waits in this chat: like a messenger, it is what the row shows.
            <T
              variant="small"
              numberOfLines={1}
              style={{ flex: 1, color: alpha(c.foreground, 0.8) }}
              testID="chat-draft"
            >
              <T variant="smallMedium" tone="primary">
                Draft:{' '}
              </T>
              {draftText(draft)}
            </T>
          ) : (
            <T
              variant="small"
              numberOfLines={1}
              style={{
                flex: 1,
                color: s.currentTask ? alpha(c.foreground, 0.8) : c.mutedForeground,
                fontStyle: s.currentTask ? 'normal' : 'italic',
              }}
            >
              {preview(s)}
            </T>
          )}
          {waiting > 0 && (
            <View
              accessibilityLabel={`${waiting} waiting for your decision`}
              style={{
                minWidth: 20,
                height: 20,
                paddingHorizontal: 6,
                borderRadius: 10,
                backgroundColor: c.warning,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <T
                variant="caption"
                style={{ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: '#000000' }}
              >
                {waiting}
              </T>
            </View>
          )}
        </View>
        <View
          style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6, overflow: 'hidden' }}
        >
          <SessionStatusBadge status={s.status} />
          <SessionKindBadge session={s} />
          <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {s.deviceName}
          </T>
        </View>
      </View>
    </Press>
  );
}

type Scope = 'active' | 'all';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
];

/** One page of the list: the sessions of one scope, filtered by the search. */
function SessionsPage({ scope, query, width }: { scope: Scope; query: string; width: number }) {
  const router = useRouter();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [pulling, setPulling] = useState(false);
  const { state, refresh } = useSessions(scope);
  const approvals = useApprovals('pending').state.data;
  const drafts = useDrafts();
  const hasDevices = (useDevices().state.data ?? []).some((d) => d.status !== 'Revoked');

  const waitingBySession = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of approvals ?? []) m.set(a.sessionId, (m.get(a.sessionId) ?? 0) + 1);
    return m;
  }, [approvals]);

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(state.data ?? [])]
      .filter(
        (s) =>
          !q ||
          [s.projectName, s.currentTask ?? '', s.deviceName, s.projectPath].some((f) =>
            f.toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  }, [state.data, query]);

  const ids = useMemo(() => (state.data ? sessions.map((s) => s.id) : null), [state.data, sessions]);
  const arriving = useArrivals(ids);

  async function pull() {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }

  const open = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } });

  let body;
  if (state.status === 'loading') {
    body = (
      <View accessibilityState={{ busy: true }} style={{ paddingHorizontal: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <Skeleton width={48} height={48} round={24} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width={160} height={16} />
              <Skeleton width="80%" height={12} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (state.status === 'error') {
    body = (
      <View style={{ paddingHorizontal: 20 }}>
        <Notice>{state.error}</Notice>
      </View>
    );
  } else if (!state.data.length && scope === 'active' && hasDevices) {
    // Nothing running: the PCs and their workspaces, to start a chat in one.
    body = (
      <Animated.View entering={arriving('workspaces', 0)} style={{ paddingHorizontal: 12, gap: 16 }}>
        <View style={{ gap: 2 }}>
          <T variant="subheading">No active chats</T>
          <T variant="small" tone="muted">
            Pick a workspace to start one. Claude Code starts there on your PC.
          </T>
        </View>
        <Workspaces />
      </Animated.View>
    );
  } else if (!state.data.length) {
    body = (
      <Animated.View
        entering={arriving('empty', 0)}
        testID="no-sessions"
        style={{ paddingHorizontal: 20, gap: 12 }}
      >
        <View style={{ gap: 2 }}>
          <T variant="subheading">{scope === 'active' ? 'No active chats' : 'No chats yet'}</T>
          <T variant="small" tone="muted">
            Claude Code sessions on your PC show up here.{' '}
            <T
              variant="smallMedium"
              tone="primary"
              accessibilityRole="link"
              onPress={() => router.push('/devices')}
            >
              Pair a PC
            </T>{' '}
            first.
          </T>
        </View>
        <T variant="smallMedium">To see sessions you start in your editor, run once:</T>
        <TerminalGuide
          steps={[{ command: 'pocket-agent hooks install', output: 'Installed Pocket Agent hooks' }]}
        />
      </Animated.View>
    );
  } else if (!sessions.length) {
    body = (
      <Animated.View entering={arriving('none', 0)} style={{ paddingHorizontal: 20, paddingVertical: 40 }}>
        <T variant="small" tone="muted" center>
          No sessions match “{query.trim()}”.
        </T>
      </Animated.View>
    );
  }

  return (
    <Animated.FlatList
      data={sessions}
      keyExtractor={(s) => s.id}
      itemLayoutAnimation={layout}
      renderItem={({ item, index }) => (
        <Animated.View entering={arriving(item.id, index)} exiting={exit.fade}>
          <SessionRow
            s={item}
            waiting={waitingBySession.get(item.id) ?? 0}
            draft={drafts.get(item.id)}
            onPress={() => open(item.id)}
          />
        </Animated.View>
      )}
      ListEmptyComponent={body}
      accessibilityLabel={`${scope === 'active' ? 'Active' : 'All'} sessions`}
      testID={`sessions-${scope}`}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      style={{ width }}
      contentContainerStyle={{
        paddingHorizontal: 8,
        paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 24,
      }}
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
 * Every session as a chat, newest activity first: the home tab. Active and All are two pages side
 * by side: swipe between them, or tap the control, which follows the swipe.
 */
export function ChatsScreen() {
  const { width } = useWindowDimensions();
  const [scope, setScope] = useState<Scope>('active');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  const index = SCOPES.findIndex((o) => o.value === scope);
  // Where the strip of pages sits (0 = Active, -width = All) and which page it is settled on.
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
      let next = rest + e.translationX;
      // Past either end the strip only gives a little.
      if (next > 0) next *= 0.25;
      else if (next < -width) next = -width + (next + width) * 0.25;
      x.set(next);
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
      const to = Math.min(SCOPES.length - 1, Math.max(0, from + step));
      page.set(to);
      x.set(withSpring(-to * width, { ...settleSpring, velocity: e.velocityX }));
      if (to !== from) scheduleOnRN(setScope, SCOPES[to]!.value);
    },
  });
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <Screen
      title="Chats"
      scroll={false}
      actions={<Button label="New chat" icon={Plus} size="sm" onPress={() => setCreating(true)} />}
    >
      <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>
        <Segmented options={SCOPES} value={scope} onChange={setScope} label="Which chats" />
        <SearchField value={query} onChangeText={setQuery} label="Search sessions" testID="session-search" />
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1, flexDirection: 'row', width: width * SCOPES.length }, strip]}>
          {SCOPES.map((o) => (
            <SessionsPage key={o.value} scope={o.value} query={query} width={width} />
          ))}
        </Animated.View>
      </GestureDetector>
      <NewChatSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}
