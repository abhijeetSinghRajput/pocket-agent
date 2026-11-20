'use client';

import { SessionListResponse, type AgentSessionDto } from '@pocket-agent/protocol';
import { Bot, ChevronRight, Laptop, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { NewSessionDialog } from '@/components/agents/new-session-dialog';
import { SessionKindBadge, SessionStatusBadge } from '@/components/agents/session-badges';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page';
import { apiRequest } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
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

function SessionCard({ s }: { s: AgentSessionDto }) {
  return (
    <li>
      <Link
        href={`/agents/${s.id}`}
        data-testid="session-card"
        data-session-id={s.externalSessionId}
        className="flex items-center gap-3 p-4 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60"
      >
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-lg',
            s.mode === 'managed' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Bot className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{s.projectName}</span>
            <SessionStatusBadge status={s.status} />
            <SessionKindBadge session={s} />
          </div>
          {s.currentTask && <p className="mt-1 truncate text-sm">{s.currentTask}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <Laptop className="size-3.5" aria-hidden />
            <span>{s.deviceName}</span>
            <span aria-hidden>·</span>
            <span>Active {timeAgo(s.lastActivityAt)}</span>
            <span aria-hidden>·</span>
            <span>{duration(s.startedAt, s.endedAt)}</span>
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

export function AgentsView() {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [creating, setCreating] = useState(false);
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions?scope=${scope}`, SessionListResponse, { signal }).then((r) => r.sessions),
    [scope],
  );
  const { state, refresh } = usePoll(fetcher, 30_000);
  useLiveRefresh(() => void refresh());
  const sessions = state.data ?? [];

  return (
    <>
      <PageHeader
        title="Agents"
        description="Claude Code sessions on your paired devices."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New session
          </Button>
        }
      />
      <NewSessionDialog open={creating} onOpenChange={setCreating} />
      <div role="tablist" aria-label="Filter" className="mb-4 inline-flex rounded-lg border bg-muted p-1">
        {(['active', 'all'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => setScope(s)}
            className={cn(
              'h-9 rounded-md px-4 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8',
              scope === s && 'bg-background text-foreground shadow-xs',
            )}
          >
            {s === 'active' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {state.status === 'loading' && (
        <div className="divide-y rounded-xl border" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <div className="size-10 animate-pulse rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}
      {state.status === 'error' && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state.status === 'ready' && sessions.length === 0 && (
        <section className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Bot className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {scope === 'active' ? 'No active sessions' : 'No sessions yet'}
          </h2>
          <div className="mt-2 max-w-md space-y-2 text-sm text-pretty text-muted-foreground">
            <p>
              With the Local Agent running, Claude Code sessions on your PC appear here automatically. For
              full detail from sessions you start in VS Code or a terminal, install the hooks once:{' '}
              <code className="font-mono text-[13px] text-foreground">pnpm pocket-agent hooks install</code>
            </p>
            <p>
              Or start a managed session:{' '}
              <code className="font-mono text-[13px] text-foreground">
                pnpm pocket-agent run &quot;your task&quot; --cwd path
              </code>
            </p>
          </div>
        </section>
      )}
      {state.status === 'ready' && sessions.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="Sessions">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} />
          ))}
        </ul>
      )}
    </>
  );
}
