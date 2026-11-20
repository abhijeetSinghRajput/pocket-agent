'use client';

import { OverviewResponse } from '@pocket-agent/protocol';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { Timeline } from '@/components/agents/timeline';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/api';
import { useLiveRefresh } from '@/lib/live';
import { usePoll, type PollState } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

export function useOverview() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/overview', OverviewResponse, { signal }),
    [],
  );
  const poll = usePoll(fetcher, 30_000);
  useLiveRefresh(() => void poll.refresh());
  return poll.state;
}

function Stat({
  label,
  value,
  href,
  tone,
  testId,
}: {
  label: string;
  value: number;
  href: string;
  tone?: 'warning';
  testId?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-xl border bg-card px-4 py-3 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        tone === 'warning' && value > 0 && 'border-warning/40 bg-warning/5',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </Link>
  );
}

export function OverviewStats({ state }: { state: PollState<OverviewResponse> }) {
  if (state.status === 'loading') {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {state.error}
      </p>
    );
  }
  const { devices, sessions } = state.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="overview-stats">
      <Stat
        label={`Devices online · ${devices.total} paired`}
        value={devices.online}
        href="/devices"
        testId="devices-online"
      />
      <Stat label="Active agents" value={sessions.active} href="/agents" testId="agents-active" />
      <Stat
        label="Waiting for input"
        value={sessions.waitingForInput}
        href="/agents"
        testId="agents-waiting"
      />
      <Stat
        label="Need permission"
        value={sessions.waitingForPermission}
        href="/agents"
        tone="warning"
        testId="agents-permission"
      />
    </div>
  );
}

export function RecentActivity({ state }: { state: PollState<OverviewResponse> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <Link
          href="/activity"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </CardHeader>
      {state.status === 'ready' ? (
        <Timeline events={state.data.recent} showSession />
      ) : (
        <div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" />
      )}
    </Card>
  );
}

export function GettingStarted({ state }: { state: PollState<OverviewResponse> }) {
  const data = state.data;
  const paired = (data?.devices.total ?? 0) > 0;
  const connected = (data?.recent.length ?? 0) > 0 || (data?.sessions.active ?? 0) > 0;
  if (paired && connected) return null; // nothing left to set up

  const steps = [
    { title: 'Create your account', detail: 'Your devices and agents are private to you.', done: true },
    {
      title: 'Pair this PC',
      detail: 'Run the Local Agent and enter a one-time code.',
      done: paired,
      href: '/devices',
    },
    {
      title: 'Connect Claude Code',
      detail: 'Start the agent; install hooks for sessions you start in VS Code or a terminal.',
      done: connected,
      href: '/agents',
    },
    {
      title: 'Control from your phone',
      detail: 'Send instructions and approve permissions.',
      milestone: 'M4–M5',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Getting started</CardTitle>
          <CardDescription className="mt-1.5">A few steps to see your agents here.</CardDescription>
        </div>
      </CardHeader>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium text-muted-foreground tabular-nums',
                step.done && 'border-success/40 bg-success/10 text-success',
              )}
            >
              {step.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {step.href && !step.done ? (
                  <Link href={step.href} className="text-sm font-medium underline-offset-4 hover:underline">
                    {step.title}
                  </Link>
                ) : (
                  <span
                    className={cn('text-sm font-medium', step.done && 'text-muted-foreground line-through')}
                  >
                    {step.title}
                  </span>
                )}
                {step.milestone && <Badge>{step.milestone}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
