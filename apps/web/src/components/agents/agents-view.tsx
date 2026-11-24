'use client';

import { SessionListResponse, type AgentSessionDto } from '@pocket-agent/protocol';
import { MessagesSquare, Pin, Plus, Search, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { NewSessionDialog } from '@/components/agents/new-session-dialog';
import { SessionAvatar, SessionKindBadge, SessionStatusBadge } from '@/components/agents/session-badges';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { TerminalGuide } from '@/components/ui/terminal-guide';
import { apiRequest } from '@/lib/api';
import { chatList, type ChatScope } from '@/lib/chat';
import { chatListTime } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { useApprovals } from '@/lib/use-approvals';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

export function duration(fromIso: string, toIso: string | null, now = Date.now()): string {
  const ms = (toIso ? Date.parse(toIso) : now) - Date.parse(fromIso);
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

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

function SessionRow({ s, active, waiting }: { s: AgentSessionDto; active: boolean; waiting: number }) {
  const busy = !s.endedAt && (s.status === 'Running' || s.status === 'WaitingForPermission');
  return (
    <li>
      <Link
        href={`/agents/${s.id}`}
        data-testid="session-card"
        data-session-id={s.externalSessionId}
        aria-current={active ? 'page' : undefined}
        className="flex items-center gap-3 rounded-xl px-3 py-3 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 aria-[current=page]:bg-accent"
      >
        <SessionAvatar session={s} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{s.projectName}</span>
            <time
              dateTime={s.lastActivityAt}
              className={cn(
                'shrink-0 text-xs tabular-nums',
                waiting ? 'font-medium text-warning' : busy ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {chatListTime(s.lastActivityAt)}
            </time>
            {s.pinned && (
              <Pin className="size-3.5 shrink-0 rotate-45 text-muted-foreground" aria-label="Pinned" />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                s.currentTask ? 'text-foreground/80' : 'text-muted-foreground italic',
              )}
            >
              {preview(s)}
            </p>
            {waiting > 0 && (
              <span
                className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-black tabular-nums"
                aria-label={`${waiting} waiting for your decision`}
              >
                {waiting}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
            <SessionStatusBadge status={s.status} />
            <SessionKindBadge session={s} />
            <span className="truncate text-xs text-muted-foreground">{s.deviceName}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Every session as a chat, newest activity first — the left pane on desktop, the whole screen on phones. */
const SCOPES = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: 'archived', label: 'Archived' },
] as const;

export function AgentsView({ activeId = null }: { activeId?: string | null }) {
  const [scope, setScope] = useState<ChatScope>('active');
  // Archived chats come from the full list (pinned and archived are set from the phone app).
  const from = scope === 'archived' ? 'all' : scope;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions?scope=${from}`, SessionListResponse, { signal }).then((r) => r.sessions),
    [from],
  );
  const { state, refresh } = usePoll(['sessions', from], fetcher, 30_000);
  useLiveRefresh(() => void refresh());
  const approvals = useApprovals('pending').state.data;

  const waitingBySession = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of approvals ?? []) m.set(a.sessionId, (m.get(a.sessionId) ?? 0) + 1);
    return m;
  }, [approvals]);

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Pinned first, then latest activity; archived chats only under Archived.
    return chatList(state.data ?? [], scope).filter(
      (s) =>
        !q ||
        [s.projectName, s.currentTask ?? '', s.deviceName, s.projectPath].some((f) =>
          f.toLowerCase().includes(q),
        ),
    );
  }, [state.data, query, scope]);
  const listed = state.data ? chatList(state.data, scope).length : 0;

  const Title = activeId ? 'h2' : 'h1';

  return (
    <section
      className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-card lg:h-dvh lg:min-h-0"
      aria-label="Sessions"
    >
      <div className="px-4 pt-5 pb-2 lg:pt-6">
        <div className="flex items-center justify-between gap-3">
          <Title className="sr-only">Chats</Title>
          <Segmented as="tab" label="Filter" options={SCOPES} value={scope} onChange={setScope} />
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New chat
          </Button>
        </div>
        <NewSessionDialog open={creating} onOpenChange={setCreating} />

        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor="session-search" className="sr-only">
            Search sessions
          </label>
          <input
            id="session-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-10 w-full rounded-full border-0 bg-muted pr-9 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-1.5 pb-4 lg:overflow-y-auto">
        {state.status === 'loading' && (
          <div aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="size-12 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}
        {state.status === 'error' && (
          <p
            role="alert"
            className="mx-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {state.error}
          </p>
        )}
        {state.status === 'ready' && !listed && scope === 'archived' && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No archived chats. Archive one from the Pocket Agent app (long-press a chat).
          </p>
        )}
        {state.status === 'ready' && !listed && scope !== 'archived' && (
          <section className="stagger mx-2.5 mt-2 flex flex-col gap-3" data-testid="no-sessions">
            <div className="px-1">
              <h2 className="text-base font-semibold">
                {scope === 'active' ? 'No active chats' : 'No chats yet'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Claude Code sessions on your PC show up here.{' '}
                <Link href="/devices" className="font-medium text-primary underline-offset-4 hover:underline">
                  Pair a PC
                </Link>{' '}
                first.
              </p>
            </div>
            <p className="px-1 text-sm font-medium">To see sessions you start in your editor, run once:</p>
            <TerminalGuide
              steps={[{ command: 'pocket-agent hooks install', output: 'Installed Pocket Agent hooks' }]}
            />
          </section>
        )}
        {state.status === 'ready' && listed > 0 && !sessions.length && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No sessions match “{query.trim()}”.
          </p>
        )}
        {sessions.length > 0 && (
          <ul className="stagger flex flex-col" aria-label="Sessions list" data-enter-new="">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                active={s.id === activeId}
                waiting={waitingBySession.get(s.id) ?? 0}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Desktop right pane when no chat is open. */
export function NoChatSelected() {
  return (
    <div className="hidden h-dvh flex-col items-center justify-center gap-4 px-8 text-center lg:flex">
      <Image src="/icons/logo-64.png" alt="" width={64} height={64} className="size-16 opacity-90" />
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Pocket Agent</h2>
        <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">Pick a chat on the left.</p>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessagesSquare className="size-3.5" aria-hidden /> Live from your paired PCs
      </p>
    </div>
  );
}
