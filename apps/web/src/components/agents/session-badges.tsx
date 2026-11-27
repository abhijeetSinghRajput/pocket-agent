import { hooksAreConnected } from '@pocket-agent/core';
import type { AgentSessionDto, AgentStatus } from '@pocket-agent/protocol';
import { Bot, Code, EyeOff, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { AGENT_LOGOS, AgentLogo, agentInk } from '@/components/agents/agent-logos';
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

/** Round chat avatar: the agent's own logo, with a presence dot for the live status. */
export function SessionAvatar({
  session,
  size = 'md',
}: {
  session: Pick<AgentSessionDto, 'provider' | 'status'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const s = STATUS[session.status];
  const logo = AGENT_LOGOS[session.provider];
  return (
    <span
      aria-hidden
      title={logo.title}
      style={{
        ...agentInk(session.provider),
        backgroundColor: 'color-mix(in oklab, var(--agent-ink) 14%, transparent)',
      }}
      className={cn(
        'agent-ink relative grid shrink-0 place-items-center rounded-full',
        size === 'sm' ? 'size-9' : size === 'lg' ? 'size-16' : 'size-12',
      )}
    >
      <AgentLogo
        provider={session.provider}
        className={size === 'lg' ? 'size-8' : size === 'sm' ? 'size-5' : 'size-6'}
      />
      <span
        className={cn(
          'absolute right-0 bottom-0 rounded-full ring-2 ring-card',
          size === 'lg' ? 'size-3.5' : 'size-3',
          DOT[s.variant],
          s.pulse && 'animate-pulse',
        )}
      />
    </span>
  );
}

export function SessionStatusBadge({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  if (status === 'Running' || status === 'Starting') {
    // Working: just a spinner, no pill around it.
    return (
      <span
        data-testid="session-status"
        data-status={status}
        title={s.label}
        className="inline-grid size-5 shrink-0 place-items-center"
      >
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-success/25 border-t-success"
        />
        <span className="sr-only">{s.label}</span>
      </span>
    );
  }
  return (
    <Badge variant={s.variant} data-testid="session-status" data-status={status} title={s.label}>
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[s.variant], s.pulse && 'animate-pulse')} />
      {s.label}
    </Badge>
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
    s.metadata?.['entrypoint'] === 'claude-vscode' || s.metadata?.['entrypoint'] === 'codex-vscode'
      ? 'VS Code'
      : s.metadata?.['entrypoint'] === 'cli'
        ? 'Terminal'
        : 'Claude Code';
  if (s.metadata?.['watch'] === 'status') {
    return {
      label: `${where} · status only`,
      hint: 'Started by you in the terminal. Antigravity keeps its conversation to itself, so only whether it is working shows here.',
    };
  }
  if (s.metadata?.['transcript'] === 'watched') {
    return {
      label: `${where} · watch only`,
      hint: 'Started by you. Pocket Agent follows it from Codex’s session files: you see it here, but can’t answer or stop it.',
    };
  }
  if (!hooksAreConnected(s)) {
    return {
      label: `${where} · status only`,
      hint: 'Started by you. Pocket Agent hooks are not installed, so only the coarse status is visible.',
    };
  }
  return { label: where, hint: 'Started by you. Pocket Agent observes it through Claude Code hooks.' };
}

/** The VS Code mark, as a small monochrome-friendly glyph (identifies the editor a session runs in). */
function VsCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.2 1.6 22 3.9c.5.2.8.7.8 1.3v13.6c0 .6-.3 1.1-.8 1.3l-4.8 2.3c-.5.2-1.1.1-1.5-.3L6.5 13.7l-4 3c-.4.3-.9.3-1.2 0l-.9-.8a.9.9 0 0 1 0-1.3L3.9 12 .4 9.4a.9.9 0 0 1 0-1.3l.9-.8c.3-.3.8-.3 1.2 0l4 3 9.2-8.4c.4-.4 1-.5 1.5-.3ZM17.3 6.9 10.4 12l6.9 5.1V6.9Z" />
    </svg>
  );
}

type KindIcon = { Icon: (p: { className?: string }) => ReactNode; cls: string };

function kindIcon(s: Pick<AgentSessionDto, 'mode' | 'metadata'>): KindIcon {
  if (s.mode === 'managed') return { Icon: Bot, cls: 'text-primary' };
  const e = s.metadata?.['entrypoint'];
  if (e === 'claude-vscode' || e === 'codex-vscode')
    return { Icon: VsCodeIcon, cls: 'text-[#0078d4] dark:text-[#3ea6ff]' };
  if (e === 'cli') return { Icon: SquareTerminal, cls: 'text-foreground/80' };
  return { Icon: Code, cls: 'text-muted-foreground' };
}

/**
 * Where the session runs, as an icon (VS Code, terminal, managed by Pocket Agent). The PC reports
 * Claude Code's own `entrypoint` for each session. `withLabel` also spells it out (Session info).
 */
export function SessionKindBadge({
  session,
  withLabel = false,
}: {
  session: Pick<AgentSessionDto, 'mode' | 'metadata' | 'capabilities'>;
  withLabel?: boolean;
}) {
  const k = sessionKind(session);
  const { Icon, cls } = kindIcon(session);
  const statusOnly = session.mode !== 'managed' && !hooksAreConnected(session);
  return (
    <span
      title={`${k.label} — ${k.hint}`}
      data-testid="session-kind"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border bg-card text-xs font-medium',
        withLabel ? 'px-2 py-0.5' : statusOnly ? 'h-6 px-1.5' : 'size-6 justify-center',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', cls, statusOnly && 'opacity-60')} />
      {statusOnly && !withLabel && <EyeOff className="-ml-0.5 size-2.5 text-muted-foreground" aria-hidden />}
      <span className={withLabel ? undefined : 'sr-only'}>{k.label}</span>
    </span>
  );
}
