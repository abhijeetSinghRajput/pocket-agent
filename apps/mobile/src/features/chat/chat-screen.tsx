import { buildChat, chatMatches, isBusy, pendingQuestion, timeAgo } from '@pocket-agent/core';
import type { AgentSessionDto } from '@pocket-agent/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PermissionSheet } from '@/features/approvals/permission-sheet';
import { QuestionSheet } from '@/features/approvals/question-sheet';
import { ChatSearchBar } from '@/features/chat/chat-search';
import { Composer, EndSessionButton } from '@/features/chat/composer';
import { useOutbox } from '@/features/chat/outbox';
import { ChatMessages, RetryContext } from '@/features/chat/messages';
import { SessionInfo } from '@/features/chat/session-info';
import { SessionAvatar } from '@/features/sessions/badges';
import { markRead, useApprovals, useCommands, useEventFeed, useSession } from '@/lib/data';
import { chatLink } from '@/lib/links';
import { foreground, useLiveEvents, useLiveRefresh } from '@/lib/live';
import { ease, enter } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { ConnectionStrip } from '@/ui/connection-strip';
import { Button, buzz, IconButton, Press, T } from '@/ui/core';
import { Roll, Skeleton } from '@/ui/feedback';

/** How far above the message box the background starts fading in. */
const FADE = 28;

/** What the header says under the name, like a messenger's "online" / "typing…". */
function presence(s: AgentSessionDto, sending: boolean): { text: string; live: boolean } {
  if (s.endedAt && !sending) return { text: `ended ${timeAgo(s.endedAt)}`, live: false };
  // Just sent, before the PC reports Claude on it: shown at once instead of seconds later.
  if (sending && !isBusy(s)) return { text: 'sending…', live: true };
  switch (s.status) {
    case 'Starting':
      return { text: 'starting…', live: true };
    case 'Running':
      return { text: 'working…', live: true };
    case 'WaitingForPermission':
      return { text: 'needs permission', live: true };
    case 'WaitingForInput':
      return { text: 'waiting for you', live: false };
    case 'Disconnected':
      return { text: `PC offline · last seen ${timeAgo(s.lastActivityAt)}`, live: false };
    default:
      return { text: `active ${timeAgo(s.lastActivityAt)}`, live: false };
  }
}

function typingKind(s: AgentSessionDto): 'working' | 'starting' | null {
  if (s.endedAt) return null;
  if (s.status === 'Running') return 'working';
  if (s.status === 'Starting') return 'starting';
  return null;
}

/**
 * While a chat is open, its notifications ("Claude finished", "Claude is asking you", …) count as
 * seen: they are marked read when it opens, when the app comes back to it, and as new ones arrive.
 */
function useMarkChatRead(sessionId: string) {
  const client = useQueryClient();
  const mark = useCallback(() => {
    if (!foreground()) return;
    void markRead({ link: chatLink(sessionId) })
      .then(() => client.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => undefined);
  }, [sessionId, client]);
  useEffect(() => {
    mark();
    const sub = AppState.addEventListener('change', (s) => foreground(s) && mark());
    return () => sub.remove();
  }, [mark]);
  useLiveEvents((e) => {
    if (e.eventType === 'notification.created') mark();
  });
}

/** The bar on top of the chat: back, who you are talking to and how it is doing (tap for details), end. */
function Header({
  session: s,
  sending,
  onInfo,
  onSearch,
  onChange,
}: {
  session: AgentSessionDto;
  sending: boolean;
  onInfo: () => void;
  onSearch: () => void;
  onChange: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const p = presence(s, sending);
  return (
    <View
      testID="chat-header"
      style={{
        paddingTop: insets.top + 4,
        paddingBottom: 8,
        paddingHorizontal: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        backgroundColor: c.bar,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <IconButton
        icon={ArrowLeft}
        label="Back to agents"
        tone="default"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      {/* The identity block is the way into the session's details. */}
      <Press
        accessibilityRole="button"
        accessibilityLabel="Session info"
        accessibilityHint="Opens details of this session"
        testID="session-info-button"
        onPress={onInfo}
        scale={0.985}
        dim={false}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 4,
          paddingHorizontal: 4,
          borderRadius: radius.lg,
        }}
      >
        <SessionAvatar session={s} size="sm" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="subheading" numberOfLines={1} accessibilityRole="header">
            {s.projectName}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <View style={{ flexShrink: 1 }}>
              <Roll
                text={p.text}
                variant={p.live ? 'captionMedium' : 'caption'}
                color={p.live ? c.primary : c.mutedForeground}
              />
            </View>
            <T variant="caption" tone="muted" accessibilityElementsHidden>
              ·
            </T>
            <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {s.deviceName}
            </T>
          </View>
        </View>
      </Press>
      <IconButton
        icon={Search}
        label="Search in this chat"
        tone="default"
        onPress={onSearch}
        testID="chat-search-open"
      />
      <EndSessionButton session={s} onDone={onChange} />
    </View>
  );
}

/** Where the conversation will be while it loads. */
function FeedSkeleton() {
  return (
    <Animated.View
      entering={enter.fade}
      style={{ flex: 1, padding: 24, gap: 16 }}
      accessibilityState={{ busy: true }}
    >
      <Skeleton width="66%" height={48} round={radius.xl} style={{ alignSelf: 'flex-end' }} />
      <Skeleton width="75%" height={96} round={radius.xl} />
    </Animated.View>
  );
}

export function ChatScreen({ id }: { id: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useMarkChatRead(id);
  const { state, refresh } = useSession(id);
  const feed = useEventFeed(`/sessions/${id}/events`);
  const approvals = useApprovals('pending');
  // A question from Claude waiting for this chat (the first one, if several).
  const question = pendingQuestion(approvals.state.data, id);
  // Permission requests waiting for this chat, oldest first.
  const permissions = (approvals.state.data ?? []).filter(
    (a) => a.sessionId === id && a.toolName !== 'AskUserQuestion',
  );
  const commands = useCommands(id);
  const [infoOpen, setInfoOpen] = useState(false);
  // Searching in the chat: what is typed, and which match is shown (null: the newest).
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState<number | null>(null);
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    setMatchIndex(null);
  };
  // Back closes the search first.
  useEffect(() => {
    if (!searching) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearching(false);
      setQuery('');
      setMatchIndex(null);
      return true;
    });
    return () => sub.remove();
  }, [searching]);
  // Bumped on every send: the conversation scrolls back to the newest message.
  const [jump, setJump] = useState(0);
  // When a message was just sent, until the PC reports Claude working on it (or 20s pass).
  const [sentAt, setSentAt] = useState<number | null>(null);
  // The PC says Claude is on it: its own status takes over.
  if (sentAt !== null && state.data && isBusy(state.data)) setSentAt(null);
  useEffect(() => {
    if (sentAt === null) return;
    const t = setTimeout(() => setSentAt(null), 20_000);
    return () => clearTimeout(t);
  }, [sentAt]);
  const sending = sentAt !== null;
  // Height of what floats over the list's foot (the message box), so the last message clears it.
  const [dock, setDock] = useState(0);
  useLiveRefresh(
    () => void feed.refreshHead(),
    (e) => e.sessionId === id || e.eventType === 'device.status.changed',
  );
  // Messages sent from here show at once; one that could not be sent stays, to send again.
  const outbox = useOutbox({
    accepted: (command) => {
      if (command.status === 'Failed') {
        buzz(false);
        setSentAt(null);
      }
      void commands.refresh();
      void feed.refreshHead();
      void refresh();
    },
    failed: () => {
      buzz(false);
      setSentAt(null);
    },
  });
  const items = useMemo(() => {
    // Messages you sent are listed separately; while older events aren't loaded yet, show only
    // the ones from the loaded stretch, so your messages and Claude's replies always line up.
    const all = commands.state.data ?? [];
    const sent = feed.hasMore && feed.oldestAt ? all.filter((c) => c.createdAt >= feed.oldestAt!) : all;
    return [...buildChat(feed.events, sent), ...outbox.items(all)];
    // `outbox.items` reads `outbox.outgoing`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.events, feed.hasMore, feed.oldestAt, commands.state.data, outbox.outgoing]);
  // Claude already answered (too fast for its status to be seen here): nothing is on its way.
  if (
    sentAt !== null &&
    items.some((i) => (i.kind === 'assistant' || i.kind === 'tool') && Date.parse(i.at) >= sentAt)
  )
    setSentAt(null);

  // The question being asked is shown below, not also in the conversation.
  const asking = !!question;
  const shown = useMemo(
    () => (asking ? items.filter((i) => !(i.kind === 'question' && i.state === 'running')) : items),
    [items, asking],
  );
  // Search in the chat (the messages loaded so far): matches oldest first, the newest shown first.
  const matches = useMemo(() => (searching ? chatMatches(shown, query) : []), [searching, shown, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const shownMatch = matches.length ? Math.min(matchIndex ?? matches.length - 1, matches.length - 1) : -1;

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }} accessibilityState={{ busy: true }}>
        <View
          style={{
            paddingTop: insets.top + 4,
            paddingBottom: 8,
            paddingHorizontal: 16,
            height: insets.top + 64,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: c.bar,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Skeleton width={36} height={36} round={18} />
          <Skeleton width={160} height={16} />
        </View>
        <FeedSkeleton />
      </View>
    );
  }
  if (state.status === 'error') {
    const notFound = state.error === 'Not found';
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.background,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <Animated.View entering={enter.rise()} style={{ alignItems: 'center', gap: 8 }}>
          <T variant="heading" center accessibilityRole="header">
            {notFound ? 'Session not found' : 'Could not load this session'}
          </T>
          <T variant="small" tone="muted" center>
            {state.error}
          </T>
          <Button
            label="Back to agents"
            variant="outline"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={{ marginTop: 16, alignSelf: 'center' }}
          />
        </Animated.View>
      </View>
    );
  }

  const s = state.data;
  const changed = () => {
    void refresh();
    void feed.refreshHead();
    void commands.refresh();
  };
  const decided = () => {
    void approvals.refresh();
    changed();
  };
  const panel = question || permissions.length > 0;

  return (
    <View
      style={{ flex: 1, backgroundColor: c.background }}
      accessibilityLabel={`Conversation with ${s.projectName}`}
    >
      {searching ? (
        <ChatSearchBar
          query={query}
          onQuery={(q) => {
            setQuery(q);
            setMatchIndex(null);
          }}
          count={matches.length}
          index={Math.max(0, shownMatch)}
          onIndex={setMatchIndex}
          onClose={closeSearch}
        />
      ) : (
        <Header
          session={s}
          sending={sending}
          onInfo={() => setInfoOpen(true)}
          onSearch={() => setSearching(true)}
          onChange={changed}
        />
      )}
      <ConnectionStrip />
      <SessionInfo session={s} open={infoOpen} onClose={() => setInfoOpen(false)} onChange={changed} />

      {/*
        The keyboard pushes the composer up and the list shrinks with it. The composer already pads
        for the bottom inset, so that much of the keyboard's height is not added again.
      */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-insets.bottom} style={{ flex: 1 }}>
        {/* The list and what floats over its foot; this view shrinks with the keyboard. */}
        <View style={{ flex: 1 }}>
          {feed.status === 'loading' ? (
            <FeedSkeleton />
          ) : feed.status === 'error' ? (
            <View style={{ flex: 1, padding: 24 }}>
              <T variant="small" tone="danger" center accessibilityRole="alert">
                {feed.error}
              </T>
            </View>
          ) : (
            <RetryContext.Provider value={outbox.retry}>
              <ChatMessages
                items={shown}
                search={
                  searching
                    ? {
                        query,
                        matches: matchSet,
                        current: shownMatch >= 0 ? matches[shownMatch]! : null,
                      }
                    : undefined
                }
                typing={typingKind(s) ?? (sending ? 'sending' : null)}
                bottomInset={dock}
                jumpKey={jump}
                header={
                  feed.hasMore ? (
                    <Button
                      label={feed.loadingMore ? 'Loading…' : 'Load older messages'}
                      variant="outline"
                      size="sm"
                      disabled={feed.loadingMore}
                      onPress={() => void feed.loadMore()}
                      style={{ alignSelf: 'center', borderRadius: radius.full, marginVertical: 8 }}
                    />
                  ) : undefined
                }
              />
            </RetryContext.Provider>
          )}

          {/*
          The message box (or Claude's question / permission request) floats over the end of the
          conversation; above it the background fades in, so messages scroll under it and fade out.
        */}
          <View
            pointerEvents="box-none"
            onLayout={(e) => setDock(Math.round(e.nativeEvent.layout.height))}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          >
            {!panel && (
              <LinearGradient
                pointerEvents="none"
                colors={[alpha(c.background, 0), alpha(c.background, 0.88), c.background]}
                locations={[0, 0.4, 1]}
                style={{ position: 'absolute', left: 0, right: 0, top: -FADE, bottom: 0 }}
              />
            )}
            {panel && (
              // Claude is asking, or needs permission: that takes the message box's place until decided.
              <Animated.View
                key={question ? question.approval.id : permissions[0]!.id}
                entering={FadeInDown.duration(360)
                  .easing(ease.out)
                  .withInitialValues({ opacity: 0, transform: [{ translateY: 24 }] })}
              >
                {question ? (
                  <QuestionSheet
                    approval={question.approval}
                    questions={question.questions}
                    onDone={decided}
                  />
                ) : (
                  <PermissionSheet
                    approval={permissions[0]!}
                    more={permissions.length - 1}
                    onDone={decided}
                  />
                )}
              </Animated.View>
            )}
            {/* Hidden, not removed, while a sheet is up: the typed message and picked files stay. */}
            <Animated.View
              entering={enter.fade}
              style={{
                display: panel ? 'none' : 'flex',
                paddingHorizontal: 12,
                paddingTop: 4,
                paddingBottom: 12 + insets.bottom,
              }}
            >
              <Composer
                session={s}
                onSending={() => {
                  setJump((j) => j + 1);
                  // Optimistic: Claude starts on it right away in these sessions, so it shows as on
                  // its way at once; the PC's own status takes over when it arrives.
                  if (s.capabilities.instructAnytime) setSentAt(Date.now());
                }}
                submit={outbox.send}
                onSent={changed}
                onInfo={() => setInfoOpen(true)}
              />
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
