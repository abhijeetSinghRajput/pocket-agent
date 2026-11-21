'use client';

import { DeviceListResponse, type ClaudeUsage } from '@pocket-agent/protocol';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

/** "Resets at 1:30 PM" today, "Resets Fri, Nov 27 at 1:30 AM" otherwise. */
export function resetLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Resets at ${time}`;
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Resets ${day} at ${time}`;
}

function Meter({ label, percent, resetsAt }: { label: string; percent: number; resetsAt: string | null }) {
  const value = Math.round(Math.max(0, Math.min(100, percent)));
  // Starts empty and fills to its value, so the bar is seen arriving.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), 60);
    return () => clearTimeout(t);
  }, [value]);
  const reset = resetLabel(resetsAt);
  return (
    <div data-testid="usage-meter">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-700 ease-(--ease-out)',
            value >= 90 ? 'bg-destructive' : value >= 75 ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {reset && <p className="mt-1 text-xs text-muted-foreground">{reset}</p>}
    </div>
  );
}

function Meters({ usage }: { usage: ClaudeUsage }) {
  return (
    <div className="flex flex-col gap-4">
      {usage.session && <Meter label="Session (5hr)" {...usage.session} />}
      {usage.weekly && <Meter label="Weekly (7 day)" {...usage.weekly} />}
      {usage.models.map((m) => (
        <Meter key={m.name} label={`${m.name} limit`} percent={m.percent} resetsAt={m.resetsAt} />
      ))}
    </div>
  );
}

/**
 * The Claude plan usage of the account signed in on each PC: the same numbers as Claude Code's own
 * /usage. Read by the PC every few minutes; nothing here is estimated.
 */
export function ClaudeUsageCard() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state, refresh } = usePoll(['devices'], fetcher, 60_000);
  useLiveRefresh(
    () => void refresh(),
    (e) => e.eventType === 'device.status.changed',
  );
  const devices = (state.data ?? []).filter((d) => d.status !== 'Revoked');
  const reporting = devices.filter(
    (d) => d.usage && (d.usage.session || d.usage.weekly || d.usage.models.length),
  );

  // Says exactly why there is nothing to show: the words match the status on the Devices page.
  const empty = !devices.length
    ? { title: 'No PC paired', hint: 'Pair a PC to see your usage.' }
    : devices.some((d) => d.status === 'Online')
      ? { title: 'No usage from your PC yet', hint: 'Update Pocket Agent on it to see your usage.' }
      : { title: 'Your PC is offline', hint: 'Usage shows up when it is online.' };

  return (
    <section className="rounded-xl bg-card p-4" aria-labelledby="usage-heading" data-testid="claude-usage">
      <h2 id="usage-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Claude usage
      </h2>
      {state.status === 'loading' && (
        <div className="mt-3 h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      )}
      {state.status === 'error' && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.status === 'ready' && reporting.length === 0 && (
        <div className="flex flex-col items-center px-2 pt-1 pb-3 text-center" data-testid="no-usage">
          <Image
            src="/illustrations/pc-offline.webp"
            alt=""
            width={768}
            height={512}
            className="h-auto w-60 rounded-2xl"
          />
          <p className="mt-1 text-sm font-medium">{empty.title}</p>
          <p className="text-sm text-muted-foreground">{empty.hint}</p>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-6">
        {reporting.map((d) => (
          <div key={d.id}>
            {/* The PC's name only matters when there is more than one. */}
            {reporting.length > 1 && <p className="mb-2 text-sm font-semibold">{d.name}</p>}
            <Meters usage={d.usage!} />
            <p className="mt-3 text-xs text-muted-foreground">
              {reporting.length === 1 && `${d.name} · `}Updated {timeAgo(d.usage!.updatedAt)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
