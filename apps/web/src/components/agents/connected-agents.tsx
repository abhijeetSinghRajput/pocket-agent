'use client';

import { agentProduct, pcAgents, timeAgo, type PcAgent } from '@pocket-agent/core';
import type { DeviceDto } from '@pocket-agent/protocol';
import { Laptop, UserRound } from 'lucide-react';
import { AgentLogo, agentBackdrop, agentInk } from '@/components/agents/agent-logos';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

// As in the app (apps/mobile/src/features/agents/connected-agents.tsx): only a state that needs
// something gets a pill; ready says nothing, and "Not installed" is the separator above those agents.
const TONE: Partial<Record<PcAgent['state'], 'warning'>> = { 'signed-out': 'warning', update: 'warning' };
// Ready ones first, then the ones a sign-in or update away.
const ORDER: Record<PcAgent['state'], number> = { ready: 0, 'signed-out': 1, update: 2, missing: 3 };

/** A label between two wavy hairlines, like a chat's "Today". */
export function LabelSeparator({ label }: { label: string }) {
  return (
    <div role="heading" aria-level={3} className="flex items-center gap-3 py-1">
      <span aria-hidden className="wavy-rule flex-1" />
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span aria-hidden className="wavy-rule flex-1" />
    </div>
  );
}

/** One agent on a PC: its mark, name, account, where it stands, and the command that fixes it. */
function AgentRow({ agent: a }: { agent: PcAgent }) {
  const name = agentProduct(a.provider);
  const tone = TONE[a.state];
  return (
    <li
      data-testid={`connected-${a.provider}`}
      aria-label={`${name}: ${a.label}.${a.account ? ` Signed in as ${a.account}.` : ''} ${a.detail}`}
      className="flex flex-col gap-2.5 px-4 py-3.5"
    >
      <div className="flex items-center gap-3">
        {/* An agent you can't chat with right now is muted; its pill and fix stay readable. */}
        <div className={cn('flex min-w-0 flex-1 items-center gap-3', a.state !== 'ready' && 'opacity-50')}>
          <span
            className="agent-ink grid size-10 shrink-0 place-items-center rounded-full"
            style={{ ...agentInk(a.provider), backgroundColor: agentBackdrop(a.provider) }}
          >
            <AgentLogo provider={a.provider} className="size-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{name}</p>
            {a.account && (
              <p className="mt-px flex items-center gap-1.5 text-sm font-medium">
                <UserRound className="size-3 shrink-0 text-muted-foreground" strokeWidth={2.4} aria-hidden />
                <span className="truncate" data-testid={`account-${a.provider}`}>
                  {a.account}
                </span>
              </p>
            )}
            <p className="line-clamp-2 text-xs text-muted-foreground">{a.detail}</p>
          </div>
        </div>
        {tone && (
          <Badge variant={tone} className="border-0">
            {a.label}
          </Badge>
        )}
      </div>
      {a.command && (
        <div className="ml-[52px] flex items-center gap-2 rounded-lg bg-muted pl-3">
          <code className="flex-1 truncate text-xs">{a.command}</code>
          <CopyButton value={a.command} label={`Copy ${a.command}`} className="size-[34px]" />
        </div>
      )}
    </li>
  );
}

function AgentList({ agents }: { agents: PcAgent[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl bg-card">
      {agents.map((a) => (
        <AgentRow key={a.provider} agent={a} />
      ))}
    </ul>
  );
}

/** One PC: its name, how many agents are ready, then its agents and, apart, the ones it doesn't have. */
function PcCard({ device: d }: { device: DeviceDto }) {
  const online = d.status === 'Online';
  const all = pcAgents(d);
  const agents = all.filter((a) => a.state !== 'missing').sort((x, y) => ORDER[x.state] - ORDER[y.state]);
  const missing = all.filter((a) => a.state === 'missing');
  const ready = all.filter((a) => a.state === 'ready').length;
  return (
    <section className="flex flex-col gap-2.5" aria-label={d.name}>
      <div className="flex items-center gap-2 px-1">
        <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="truncate text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {d.name}
        </h2>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {ready} of {all.length} ready
        </span>
      </div>
      {!online && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {`This PC is offline${d.lastHeartbeatAt ? ` (last seen ${timeAgo(d.lastHeartbeatAt)})` : ''}. This is what it reported last.`}
        </p>
      )}
      {agents.length > 0 && <AgentList agents={agents} />}
      {missing.length > 0 && (
        <>
          <div className="mt-1.5">
            <LabelSeparator label="Not installed" />
          </div>
          <AgentList agents={missing} />
        </>
      )}
    </section>
  );
}

/**
 * The coding agents on your PCs: which are ready to chat, which are signed out or need an update
 * (with the command that fixes it, to run on the PC), and which aren't installed.
 */
export function ConnectedAgents({
  devices,
  loading,
  error,
}: {
  devices: DeviceDto[] | null | undefined;
  loading: boolean;
  error: string | null;
}) {
  const pcs = (devices ?? []).filter((d) => d.status !== 'Revoked');
  if (loading)
    return (
      <div aria-busy="true" className="flex flex-col gap-2.5">
        <div className="h-3.5 w-30 animate-pulse rounded bg-muted" />
        <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  return (
    <>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && !pcs.length && (
        <div data-testid="no-connected-pcs" className="flex flex-col items-center gap-2 py-12 text-center">
          <Laptop className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">No PC connected</p>
          <p className="text-sm text-muted-foreground">
            Connect your PC in Devices, and the coding agents on it show up here.
          </p>
        </div>
      )}
      {pcs.map((d) => (
        <PcCard key={d.id} device={d} />
      ))}
    </>
  );
}
