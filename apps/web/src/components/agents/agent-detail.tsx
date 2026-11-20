'use client';

import { SessionResponse } from '@pocket-agent/protocol';
import { ArrowLeft, FolderOpen, Laptop } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { duration } from '@/components/agents/agents-view';
import { CapabilityList } from '@/components/agents/capabilities';
import { SessionKindBadge, SessionStatusBadge, sessionKind } from '@/components/agents/session-badges';
import { RemoteControl } from '@/components/agents/remote-control';
import { SessionApprovals } from '@/components/approvals/session-approvals';
import { Timeline } from '@/components/agents/timeline';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { apiRequest, NOT_FOUND_MESSAGE } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { useEventFeed } from '@/lib/use-event-feed';
import { usePoll } from '@/lib/use-poll';

export function AgentDetail({ id }: { id: string }) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${id}`, SessionResponse, { signal }).then((r) => r.session),
    [id],
  );
  const { state, refresh } = usePoll(fetcher, 30_000);
  const feed = useEventFeed(`/sessions/${id}/events`);
  useLiveRefresh(
    () => {
      void refresh();
      void feed.refreshHead();
    },
    (e) => e.sessionId === id || e.eventType === 'device.status.changed',
  );

  if (state.status === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (state.status === 'error') {
    const notFound = state.error === NOT_FOUND_MESSAGE;
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">
          {notFound ? 'Session not found' : 'Could not load this session'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{state.error}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/agents">Back to agents</Link>
        </Button>
      </div>
    );
  }

  const s = state.data;
  return (
    <>
      <Link
        href="/agents"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Agents
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight break-all">{s.projectName}</h1>
          <SessionStatusBadge status={s.status} />
          <SessionKindBadge session={s} />
        </div>
        {s.currentTask && <p className="mt-2 text-sm text-pretty">{s.currentTask}</p>}
        <dl className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">Project path</dt>
            <dd className="truncate font-mono">{s.projectPath}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Laptop className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">Device</dt>
            <dd>{s.deviceName}</dd>
          </div>
          <div>
            <dt className="inline">Started </dt>
            <dd className="inline">
              {formatDate(s.startedAt)} · {duration(s.startedAt, s.endedAt)}
            </dd>
          </div>
          <div>
            <dt className="inline">Last activity </dt>
            <dd className="inline">{timeAgo(s.lastActivityAt)}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <SessionApprovals sessionId={s.id} />
        <div className="lg:col-start-1">
          <RemoteControl
            session={s}
            onChange={() => {
              void refresh();
              void feed.refreshHead();
            }}
          />
        </div>
        <Card className="lg:col-start-1">
          <CardTitle>Activity</CardTitle>
          {feed.status === 'loading' ? (
            <div className="h-32 animate-pulse rounded-md bg-muted" aria-busy="true" />
          ) : feed.status === 'error' ? (
            <p role="alert" className="text-sm text-destructive">
              {feed.error}
            </p>
          ) : (
            <>
              <Timeline events={feed.events} />
              {feed.hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-center"
                  disabled={feed.loadingMore}
                  onClick={() => void feed.loadMore()}
                >
                  {feed.loadingMore ? 'Loading…' : 'Load older activity'}
                </Button>
              )}
            </>
          )}
        </Card>

        <Card className="h-fit lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div>
            <CardTitle>What you can do here</CardTitle>
            <p className="mt-1.5 text-xs text-muted-foreground">{sessionKind(s).hint}</p>
          </div>
          <CapabilityList session={s} />
        </Card>
      </div>
    </>
  );
}
