import { chatListTime } from '@pocket-agent/core';
import type { AgentSessionDto } from '@pocket-agent/protocol';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionAvatar, SessionKindBadge, SessionStatusBadge } from '@/features/sessions/badges';
import { NewChatSheet } from '@/features/sessions/new-chat-sheet';
import { useApprovals, useSessions } from '@/lib/data';
import { exit, layout } from '@/lib/motion';
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

function SessionRow({ s, waiting, onPress }: { s: AgentSessionDto; waiting: number; onPress: () => void }) {
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

/** Every session as a chat, newest activity first: the home tab. */
export function ChatsScreen() {
  const router = useRouter();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<Scope>('active');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);
  const { state, refresh } = useSessions(scope);
  const approvals = useApprovals('pending').state.data;

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

  const header = (
    <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>
      <Segmented options={SCOPES} value={scope} onChange={setScope} />
      <SearchField value={query} onChangeText={setQuery} label="Search sessions" testID="session-search" />
    </View>
  );

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
    <Screen
      title="Chats"
      scroll={false}
      actions={<Button label="New chat" icon={Plus} size="sm" onPress={() => setCreating(true)} />}
    >
      <Animated.FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        itemLayoutAnimation={layout}
        renderItem={({ item, index }) => (
          <Animated.View entering={arriving(item.id, index)} exiting={exit.fade}>
            <SessionRow s={item} waiting={waitingBySession.get(item.id) ?? 0} onPress={() => open(item.id)} />
          </Animated.View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={body}
        accessibilityLabel="Sessions list"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
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
      <NewChatSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}
