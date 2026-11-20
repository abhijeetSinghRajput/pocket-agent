import type { AgentSessionDto } from '@agentdock/protocol';
import { Check, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = { label: string; state: 'yes' | 'soon' | 'no'; detail: string };

/**
 * What this session can and cannot do, stated plainly. Never claims a capability the session
 * doesn't have (capabilities are reported by the PC); features this session supports but
 * AgentDock hasn't shipped yet say which milestone brings them.
 */
export function capabilityRows(s: AgentSessionDto): Row[] {
  const c = s.capabilities;
  const managed = s.mode === 'managed';
  const hooksConnected = !managed && c.remoteApproval; // observed sessions report through hooks
  const hooksWhy =
    s.metadata?.['hooks'] === 'not-connected'
      ? 'This session started before AgentDock hooks were installed. Restart it on the PC to connect it.'
      : 'AgentDock hooks are not installed on this PC. Run `agentdock hooks install`, then restart the session.';

  const instruct: Row = managed
    ? {
        label: 'Send instructions',
        state: 'yes',
        detail: 'Any time. Runs right away, or after the current task.',
      }
    : c.instructBetweenTurns
      ? {
          label: 'Send instructions',
          state: 'yes',
          detail: 'Delivered when Claude finishes its current turn. It can’t wake an idle session.',
        }
      : hooksConnected
        ? {
            label: 'Send instructions',
            state: 'no',
            detail: 'Turned off on this PC. To allow it, run `agentdock instructions enable` on the PC.',
          }
        : { label: 'Send instructions', state: 'no', detail: hooksWhy };

  return [
    {
      label: 'Live status',
      state: c.monitor ? 'yes' : 'no',
      detail:
        managed || hooksConnected
          ? 'Status, tool calls and messages stream here.'
          : 'Coarse status only (running / waiting).',
    },
    instruct,
    {
      label: 'Stop / interrupt',
      state: c.interrupt ? 'yes' : 'no',
      detail: c.interrupt
        ? 'Interrupt the current task or end the session.'
        : 'Not possible for sessions you start yourself; start a managed session instead.',
    },
    {
      label: 'Approve permissions remotely',
      state: c.remoteApproval ? 'soon' : 'no',
      detail: c.remoteApproval
        ? managed
          ? 'Arrives in M5. Until then, actions that need approval are denied (never auto-approved).'
          : 'Arrives in M5. Until then, Claude Code asks on your PC as usual.'
        : hooksWhy,
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
