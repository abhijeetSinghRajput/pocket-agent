import type { AgentSessionDto } from '@agentdock/protocol';
import { Check, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = { label: string; state: 'yes' | 'soon' | 'no'; detail: string };

/**
 * What this session can and cannot do, stated plainly. Never claims a capability the session
 * doesn't have; features this session supports but AgentDock hasn't shipped yet say so.
 */
export function capabilityRows(s: AgentSessionDto): Row[] {
  const c = s.capabilities;
  const managed = s.mode === 'managed';
  const noHooks = !managed && !c.remoteApproval && !c.instructBetweenTurns;
  const why = noHooks
    ? 'AgentDock hooks are not installed on this PC. Run `agentdock hooks install` and restart the session.'
    : 'Not possible for sessions you start yourself; start a managed session instead.';
  return [
    {
      label: 'Live status',
      state: c.monitor ? 'yes' : 'no',
      detail: noHooks
        ? 'Coarse status only (running / waiting).'
        : 'Status, tool calls and messages stream here.',
    },
    {
      label: 'Approve permissions remotely',
      state: c.remoteApproval ? 'soon' : 'no',
      detail: c.remoteApproval
        ? managed
          ? 'Arrives in M5. Until then, actions that need approval are denied (never auto-approved).'
          : 'Arrives in M5. Until then, Claude Code asks on your PC as usual.'
        : why,
    },
    {
      label: 'Send instructions',
      state: c.instructAnytime || c.instructBetweenTurns ? 'soon' : 'no',
      detail: c.instructAnytime
        ? 'Any time. Arrives in M4.'
        : c.instructBetweenTurns
          ? 'Only after Claude finishes its current turn. Arrives in M4.'
          : why,
    },
    {
      label: 'Stop / interrupt',
      state: c.interrupt ? 'soon' : 'no',
      detail: c.interrupt ? 'Arrives in M4.' : 'Not possible for sessions you start yourself.',
    },
  ];
}

const ICON = {
  yes: { Icon: Check, cls: 'bg-success/15 text-success', sr: 'Available' },
  soon: { Icon: Clock, cls: 'bg-primary/10 text-primary', sr: 'Supported, not yet available' },
  no: { Icon: X, cls: 'bg-muted text-muted-foreground', sr: 'Not available' },
} as const;

export function CapabilityList({ session }: { session: AgentSessionDto }) {
  return (
    <ul className="flex flex-col gap-3" data-testid="capabilities">
      {capabilityRows(session).map((r) => {
        const { Icon, cls, sr } = ICON[r.state];
        return (
          <li key={r.label} className="flex gap-3" data-capability={r.label} data-state={r.state}>
            <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', cls)}>
              <Icon className="size-3" aria-hidden />
              <span className="sr-only">{sr}</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">{r.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
