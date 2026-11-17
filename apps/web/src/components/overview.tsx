'use client';

import { DeviceListResponse } from '@agentdock/protocol';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/api';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

export function DevicesSummary() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state } = usePoll(fetcher, 10_000);
  const active = (state.data ?? []).filter((d) => d.status !== 'Revoked');
  const online = active.filter((d) => d.status === 'Online').length;

  return (
    <Card data-testid="devices-summary">
      <CardHeader>
        <div>
          <CardTitle>Devices</CardTitle>
          <CardDescription className="mt-1.5">PCs paired with your account.</CardDescription>
        </div>
        <Link href="/devices" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Manage
        </Link>
      </CardHeader>
      {state.status === 'loading' ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" aria-busy="true" />
      ) : state.status === 'error' ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Online</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums" data-testid="devices-online">
              {online}
            </dd>
          </div>
          <div className="rounded-lg border px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Paired</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{active.length}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

export function GettingStarted({ paired }: { paired?: boolean }) {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state } = usePoll(fetcher, 30_000);
  const hasDevice = paired ?? (state.data ?? []).some((d) => d.status !== 'Revoked');

  const steps = [
    { title: 'Create your account', detail: 'Your devices and agents are private to you.', done: true },
    {
      title: 'Pair this PC',
      detail: 'Run the Local Agent and enter a one-time code.',
      done: hasDevice,
      href: '/devices',
    },
    { title: 'Connect Claude Code', detail: 'See managed and VS Code sessions live here.', milestone: 'M3' },
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
          <CardDescription className="mt-1.5">
            Agent stats appear here once Claude Code is connected.
          </CardDescription>
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
