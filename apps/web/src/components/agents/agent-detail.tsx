'use client';

import { agentName } from '@pocket-agent/core';
import { SessionResponse, type AgentSessionDto } from '@pocket-agent/protocol';
import { ArrowLeft, FolderOpen, Laptop, X } from 'lucide-react';
import Link from 'next/link';
import { Dialog } from 'radix-ui';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { duration } from '@/components/agents/agents-view';
import { CapabilityList } from '@/components/agents/capabilities';
import { AgentName, ChatMessages } from '@/components/agents/chat-messages';
import { Composer, EndSessionButton, SessionControls, useCommands } from '@/components/agents/remote-control';
import {
  SessionAvatar,
  SessionKindBadge,
  SessionStatusBadge,
  sessionKind,
} from '@/components/agents/session-badges';
import { QuestionSheet } from '@/components/approvals/question-sheet';
import { PermissionSheet } from '@/components/approvals/permission-sheet';
import { useApprovals } from '@/lib/use-approvals';
import { pendingQuestion } from '@/lib/commands';
import { Button } from '@/components/ui/button';
import { apiRequest, NOT_FOUND_MESSAGE } from '@/lib/api';
import { useBackToClose } from '@/components/ui/dialog';
import { buildChat } from '@/lib/chat';
import { formatDate, timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { useEventFeed } from '@/lib/use-event-feed';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';
import { useMarkChatRead } from '@/lib/use-notifications';

/** What the header says under the name, like a messenger's "online" / "typing…". */
function presence(s: AgentSessionDto): { text: string; live: boolean } {
  if (s.endedAt) return { text: `ended ${timeAgo(s.endedAt)}`, live: false };
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

function SessionInfo({
  session: s,
  open,
  onOpenChange,
  onChange,
}: {
  session: AgentSessionDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChange: () => void;
}) {
  useBackToClose(open, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          data-testid="session-info"
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto border-l bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-xl outline-none sm:max-w-md data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-2 pt-[env(safe-area-inset-top)]">
            <Dialog.Close
              aria-label="Close"
              className="grid size-10 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="text-base font-semibold">Session info</Dialog.Title>
          </div>
          <Dialog.Description className="sr-only">
            Details and what you can do in this session.
          </Dialog.Description>

          <div className="flex flex-col items-center gap-2 border-b px-5 py-6 text-center">
            <SessionAvatar session={s} size="lg" />
            <p className="mt-1 text-lg font-semibold break-all">{s.projectName}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              <SessionStatusBadge status={s.status} />
              <SessionKindBadge session={s} withLabel />
            </div>
            {s.currentTask && (
              <p className="mt-1 text-sm text-pretty text-muted-foreground">{s.currentTask}</p>
            )}
          </div>

          <dl className="flex flex-col gap-3 border-b px-5 py-4 text-sm">
            <div className="flex min-w-0 items-start gap-3">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <dt className="sr-only">Project path</dt>
              <dd className="min-w-0 font-mono text-[12.5px] break-all">{s.projectPath}</dd>
            </div>
            <div className="flex items-center gap-3">
              <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <dt className="sr-only">Device</dt>
              <dd>{s.deviceName}</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <dt>Started</dt>
              <dd className="text-foreground">
                {formatDate(s.startedAt)} · {duration(s.startedAt, s.endedAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 text-muted-foreground">
              <dt>Last activity</dt>
              <dd className="text-foreground">{timeAgo(s.lastActivityAt)}</dd>
            </div>
          </dl>

          <section className="flex flex-col gap-3 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">What you can do here</h2>
              <p className="mt-1 text-xs text-muted-foreground">{sessionKind(s).hint}</p>
            </div>
            <CapabilityList session={s} />
          </section>

          {s.capabilities.interrupt && !s.endedAt && (
            <section className="border-t px-5 py-4">
              <SessionControls session={s} onDone={onChange} />
            </section>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Keeps the chat exactly as tall as what is visible. When the on-screen keyboard opens, browsers
 * that only shrink the visual viewport would otherwise scroll the page and push the header away.
 */
function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const root = document.documentElement;
    const fit = () => {
      root.style.setProperty('--chat-height', `${Math.round(vv.height)}px`);
      if (vv.offsetTop || window.scrollY) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      root.style.removeProperty('--chat-height');
    };
  }, []);
}

export function AgentDetail({ id }: { id: string }) {
  useVisibleHeight();
  useMarkChatRead(id);
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${id}`, SessionResponse, { signal }).then((r) => r.session),
    [id],
  );
  const { state, refresh } = usePoll(['session', id], fetcher, 30_000);
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
  useLiveRefresh(
    () => {
      void refresh();
      void feed.refreshHead();
    },
    (e) => e.sessionId === id || e.eventType === 'device.status.changed',
  );
  const items = useMemo(() => {
    // Messages you sent are listed separately; while older events aren't loaded yet, show only
    // the ones from the loaded stretch, so your messages and Claude's replies always line up.
    const all = commands.state.data ?? [];
    const sent = feed.hasMore && feed.oldestAt ? all.filter((c) => c.createdAt >= feed.oldestAt!) : all;
    return buildChat(feed.events, sent);
  }, [feed.events, feed.hasMore, feed.oldestAt, commands.state.data]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-dvh flex-col" aria-busy="true">
        <div className="flex h-16 items-center gap-3 border-b px-4">
          <div className="size-10 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        </div>
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6">
          <div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-muted" />
          <div className="h-24 w-3/4 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    const notFound = state.error === NOT_FOUND_MESSAGE;
    return (
      <div className="grid h-dvh place-items-center px-4 text-center">
        <div>
          <h1 className="text-xl font-semibold">
            {notFound ? 'Session not found' : 'Could not load this session'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{state.error}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/agents">Back to agents</Link>
          </Button>
        </div>
      </div>
    );
  }

  const s = state.data;
  const p = presence(s);
  const changed = () => {
    void refresh();
    void feed.refreshHead();
    void commands.refresh();
  };
  const decided = () => {
    void approvals.refresh();
    changed();
  };

  return (
    <section
      className="flex h-[var(--chat-height,100dvh)] flex-col overflow-hidden bg-background"
      aria-label={`Conversation with ${s.projectName}`}
    >
      <header
        data-testid="chat-header"
        className="z-10 flex shrink-0 items-center gap-1 border-b bg-card/90 px-1.5 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:gap-2 sm:px-3"
      >
        <Link
          href="/agents"
          aria-label="Back to agents"
          className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="relative flex h-16 min-w-0 flex-1 items-center gap-3 pl-1 lg:pl-2">
          {/* The whole identity block opens the session's details. */}
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Session info"
            title="Session info"
            className="absolute inset-0 z-10 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <SessionAvatar session={s} size="sm" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] leading-tight font-semibold">{s.projectName}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
              <span className={cn('truncate', p.live ? 'font-medium text-primary' : 'text-muted-foreground')}>
                <span key={p.text} className="roll-in">
                  {p.text}
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="truncate text-muted-foreground">{s.deviceName}</span>
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <SessionKindBadge session={s} />
          </div>
          <span className="hidden shrink-0 sm:inline-flex">
            <SessionStatusBadge status={s.status} />
          </span>
        </div>
        <EndSessionButton session={s} onDone={changed} />
      </header>
      <SessionInfo session={s} open={infoOpen} onOpenChange={setInfoOpen} onChange={changed} />

      {feed.status === 'loading' ? (
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6" aria-busy="true">
          <div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-muted" />
          <div className="h-24 w-3/4 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : feed.status === 'error' ? (
        <p role="alert" className="flex-1 p-6 text-center text-sm text-destructive">
          {feed.error}
        </p>
      ) : (
        <AgentName.Provider value={agentName(s.provider)}>
          <ChatMessages
            items={
              // The question being asked is shown below, not also in the conversation.
              question ? items.filter((i) => !(i.kind === 'question' && i.state === 'running')) : items
            }
            typing={typingKind(s)}
            header={
              feed.hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-center rounded-full"
                  disabled={feed.loadingMore}
                  onClick={() => void feed.loadMore()}
                >
                  {feed.loadingMore ? 'Loading…' : 'Load older messages'}
                </Button>
              )
            }
          />
        </AgentName.Provider>
      )}

      {(question || permissions.length > 0) && (
        // Claude is asking, or needs permission: that takes the message box's place until decided.
        <div className="shrink-0 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {question ? (
              <QuestionSheet
                key={question.approval.id}
                approval={question.approval}
                questions={question.questions}
                onDone={decided}
              />
            ) : (
              <PermissionSheet
                key={permissions[0]!.id}
                approval={permissions[0]!}
                more={permissions.length - 1}
                onDone={decided}
              />
            )}
          </div>
        </div>
      )}
      {/*
        Hidden, not removed, while a sheet is up: the typed message and picked files stay.
        No hard edge above it: the conversation fades out into the background as it reaches the box.
      */}
      <div
        hidden={!!question || permissions.length > 0}
        className="relative shrink-0 bg-background px-3 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <Composer session={s} onSent={changed} onInfo={() => setInfoOpen(true)} />
        </div>
      </div>
    </section>
  );
}
