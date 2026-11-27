'use client';

import type { ApprovalDto } from '@pocket-agent/protocol';
import { Bot, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AgentMap } from '@/components/agents/agent-map';
import { ConnectedAgents } from '@/components/agents/connected-agents';
import { NewSessionDialog } from '@/components/agents/new-session-dialog';
import { APPROVAL_STATUS, ApprovalCard } from '@/components/approvals/approval-card';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { requestTarget } from '@/lib/chat';
import { timeAgo } from '@/lib/format';
import { useApprovals } from '@/lib/use-approvals';
import { useDevices, useWorkers } from '@/lib/use-workers';
import { cn } from '@/lib/utils';

// The web port of the app's Agents tab (apps/mobile/src/features/agents/agents-screen.tsx):
// Connected (the coding agents on your PCs), Sub-agents (what needs you, then what runs now) and
// Finished (today's, and the decisions made).

type Page = 'connected' | 'active' | 'finished';

/** How long a decided request stays, showing its result, before the list closes over its place. */
const SETTLE_MS = 1400;

/** Re-renders every `ms`, so "for 12 min" stays true while the page is open. */
function useTick(ms: number) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Empty({
  testId,
  title,
  body,
  action,
}: {
  testId: string;
  title: string;
  body: string;
  action?: () => void;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Bot className="size-6" aria-hidden />
      </span>
      <p className="mt-1 font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">{body}</p>
      {action && (
        <Button size="sm" className="mt-2" onClick={action}>
          <Plus aria-hidden /> New chat
        </Button>
      )}
    </div>
  );
}

/** The decisions already made, folded away until asked for. */
function RecentDecisions({ items }: { items: ApprovalDto[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="recent-decisions"
        className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Recent decisions <span className="opacity-60">{items.length}</span>
        <span className="flex-1" />
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="divide-y rounded-2xl bg-card" data-testid="approval-history">
          {items.map((a) => {
            const s = APPROVAL_STATUS[a.status];
            return (
              <li key={a.id} data-testid="approval-history-row" className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px]">
                    {requestTarget(a.toolName, a.input) || a.toolName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.projectName} · {timeAgo(a.createdAt)}
                  </p>
                </div>
                <Badge variant={s.tone} className="shrink-0 border-0">
                  {a.status === 'Pending' && a.decision ? 'Sent to PC' : s.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function AgentsPage() {
  useTick(30_000);
  const workers = useWorkers();
  const pending = useApprovals('pending');
  const history = useApprovals('all');
  const devices = useDevices();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Page>('connected');

  // Decided requests stay a moment, showing their result, before the refresh takes them away.
  const [settling, setSettling] = useState<{ approval: ApprovalDto; index: number }[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);
  const refreshAll = () => void Promise.all([workers.refresh(), pending.refresh(), history.refresh()]);
  const decided = (a: ApprovalDto, index: number) => {
    setSettling((s) => (s.some((x) => x.approval.id === a.id) ? s : [...s, { approval: a, index }]));
    clearTimeout(timers.current.get(a.id));
    timers.current.set(
      a.id,
      setTimeout(() => {
        setSettling((s) => s.filter((x) => x.approval.id !== a.id));
        refreshAll();
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

  const loadingView = loading && (
    <div aria-busy="true" className="flex flex-col gap-2.5">
      <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
      <div className="h-42 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
  const errors = (
    <>
      {workers.state.status === 'error' && (
        <p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm text-destructive">
          {workers.state.error}
        </p>
      )}
      {pending.state.status === 'error' && (
        <p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm text-destructive">
          {pending.state.error}
        </p>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Agents"
        description={summary}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New chat
          </Button>
        }
      />
      <Segmented
        as="tab"
        label="Which agents"
        value={tab}
        onChange={setTab}
        className="mb-5 w-full [&>button]:flex-1 [&>button]:justify-center"
        options={[
          { value: 'connected', label: 'Connected' },
          { value: 'active', label: running.length ? `Sub-agents · ${running.length}` : 'Sub-agents' },
          { value: 'finished', label: finished.length ? `Finished · ${finished.length}` : 'Finished' },
        ]}
      />

      <div className="flex flex-col gap-5" data-testid={`agents-${tab}`}>
        {tab === 'connected' && (
          <ConnectedAgents
            devices={devices.state.data}
            loading={devices.state.status === 'loading'}
            error={devices.state.status === 'error' ? devices.state.error : null}
          />
        )}

        {tab === 'active' && (
          <>
            {loadingView}
            {errors}
            {needs.length > 0 && (
              <section className="flex flex-col gap-2.5" data-testid="needs-you">
                <h2 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wider text-warning uppercase">
                  <span aria-hidden className="size-[7px] rounded-full bg-warning" />
                  Needs you <span className="opacity-60">{needs.length}</span>
                </h2>
                <div className="stagger grid gap-3 md:grid-cols-2" data-enter-new="">
                  {needs.map((a, i) => (
                    <ApprovalCard key={a.id} approval={a} onDecided={() => decided(a, i)} />
                  ))}
                </div>
              </section>
            )}
            {!loading && running.length > 0 && <AgentMap workers={running} />}
            {!loading && !running.length && !needs.length && (
              <Empty
                testId="no-agents"
                title="Nothing running"
                body={
                  finished.length
                    ? 'Sub-agents and workflows your chats start show up here while they run. The ones that finished today are under Finished.'
                    : 'When a chat sends sub-agents or a workflow to work, they show up here while they run. Anything that needs you shows up here too.'
                }
                action={() => setCreating(true)}
              />
            )}
          </>
        )}

        {tab === 'finished' && (
          <>
            {loadingView}
            {errors}
            {!loading && finished.length > 0 && <AgentMap workers={finished} />}
            {!loading && !finished.length && (
              <Empty
                testId="no-finished-agents"
                title="Nothing finished today"
                body="Agents that finish stay here for a day."
              />
            )}
            {!loading && <RecentDecisions items={recent} />}
          </>
        )}
      </div>
      <NewSessionDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
