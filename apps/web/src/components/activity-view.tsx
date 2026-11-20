'use client';

import { Activity } from 'lucide-react';
import { Timeline } from '@/components/agents/timeline';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useLiveRefresh } from '@/lib/live';
import { useEventFeed } from '@/lib/use-event-feed';

export function ActivityView() {
  const feed = useEventFeed('/activity');
  useLiveRefresh(
    () => void feed.refreshHead(),
    (e) => e.eventType === 'agent.event.created',
  );

  return (
    <>
      <PageHeader
        title="Activity"
        description="Sessions, tool runs, permission requests and results across all agents."
      />
      {feed.status === 'loading' && (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      )}
      {feed.status === 'error' && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {feed.error}
        </p>
      )}
      {feed.status === 'ready' && feed.events.length === 0 && (
        <section className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Activity className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-base font-semibold">No activity yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Agent events appear here in real time once a paired PC reports its Claude Code sessions.
          </p>
        </section>
      )}
      {feed.status === 'ready' && feed.events.length > 0 && (
        <div className="flex flex-col rounded-xl border bg-card px-4 py-2">
          <Timeline events={feed.events} showSession />
          {feed.hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="my-2 self-center"
              disabled={feed.loadingMore}
              onClick={() => void feed.loadMore()}
            >
              {feed.loadingMore ? 'Loading…' : 'Load older activity'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
