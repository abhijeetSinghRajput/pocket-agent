import type { AgentSessionDto, AgentStatus } from '@pocket-agent/protocol';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS: Record<
  AgentStatus,
  { label: string; variant: 'success' | 'neutral' | 'warning' | 'danger' | 'accent'; pulse?: boolean }
> = {
  Starting: { label: 'Starting', variant: 'accent', pulse: true },
  Running: { label: 'Running', variant: 'success', pulse: true },
  WaitingForInput: { label: 'Waiting for input', variant: 'accent' },
  WaitingForPermission: { label: 'Needs permission', variant: 'warning', pulse: true },
  Completed: { label: 'Completed', variant: 'neutral' },
  Failed: { label: 'Failed', variant: 'danger' },
  Stopped: { label: 'Ended', variant: 'neutral' },
  Disconnected: { label: 'PC offline', variant: 'neutral' },
};

const DOT: Record<string, string> = {
  success: 'bg-success',
  accent: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground/50',
};

export function SessionStatusBadge({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} data-testid="session-status" data-status={status}>
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[s.variant], s.pulse && 'animate-pulse')} />
      {s.label}
    </Badge>
  );
}

/**
 * Whether an observed session reports through Pocket Agent hooks. The PC records this in metadata;
 * capabilities can't be used for it because instructions/approvals are separate PC opt-ins.
 */
export function hooksAreConnected(s: Pick<AgentSessionDto, 'metadata' | 'capabilities'>): boolean {
  return (
    s.metadata?.['hooks'] === 'connected' ||
    s.capabilities.remoteApproval ||
    s.capabilities.instructBetweenTurns
  );
}

/** How the session is connected, in user terms. */
export function sessionKind(s: Pick<AgentSessionDto, 'mode' | 'metadata' | 'capabilities'>): {
  label: string;
  hint: string;
} {
  if (s.mode === 'managed') {
    return { label: 'Managed', hint: 'Started by Pocket Agent on your PC — full remote control.' };
  }
  const where =
    s.metadata?.['entrypoint'] === 'claude-vscode'
      ? 'VS Code'
      : s.metadata?.['entrypoint'] === 'cli'
        ? 'Terminal'
        : 'Claude Code';
  if (!hooksAreConnected(s)) {
    return {
      label: `${where} · status only`,
      hint: 'Started by you. Pocket Agent hooks are not installed, so only the coarse status is visible.',
    };
  }
  return { label: where, hint: 'Started by you. Pocket Agent observes it through Claude Code hooks.' };
}

export function SessionKindBadge({
  session,
}: {
  session: Pick<AgentSessionDto, 'mode' | 'metadata' | 'capabilities'>;
}) {
  const k = sessionKind(session);
  return (
    <Badge
      variant={session.mode === 'managed' ? 'accent' : 'neutral'}
      title={k.hint}
      data-testid="session-kind"
    >
      {k.label}
    </Badge>
  );
}
