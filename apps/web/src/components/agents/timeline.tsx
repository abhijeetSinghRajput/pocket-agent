'use client';

import type { AgentEventDto } from '@pocket-agent/protocol';
import {
  AlertTriangle,
  Bot,
  CircleCheck,
  CircleX,
  Flag,
  type LucideIcon,
  Play,
  ShieldAlert,
  ShieldCheck,
  Square,
  User,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The single most useful field of a summarised tool input. */
export function toolTarget(input: unknown): string {
  try {
    const i = JSON.parse(str(input)) as P;
    return (
      str(i['command']) ||
      str(i['file_path']) ||
      str(i['pattern']) ||
      str(i['url']) ||
      str(i['query']) ||
      str(i['description']) ||
      str(i['notebook_path']) ||
      ''
    );
  } catch {
    return '';
  }
}

const OUTCOME: Record<string, string> = {
  local: 'Answered on the PC',
  remote: 'Answered in Pocket Agent',
  auto_denied: 'Denied automatically — no approval channel yet',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
};

const STATUS_TEXT: Record<string, string> = {
  Running: 'Working',
  WaitingForInput: 'Waiting for input',
  WaitingForPermission: 'Waiting for permission',
  Failed: 'Turn failed',
  Starting: 'Starting',
};

interface View {
  icon: LucideIcon;
  tone: 'default' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';
  title: string;
  body?: string;
  mono?: boolean;
  /** Long text is collapsed behind "Show more". */
  long?: boolean;
}

export function describeEvent(e: AgentEventDto): View | null {
  const p = e.payload;
  switch (e.eventType) {
    case 'agent.session.started':
      return {
        icon: Play,
        tone: 'muted',
        title: p['startSource'] === 'resume' ? 'Session resumed' : 'Session started',
      };
    case 'agent.session.updated':
      if (p['currentTask']) return null; // the user message right before it already says this
      return STATUS_TEXT[str(p['status'])]
        ? { icon: Flag, tone: 'muted', title: STATUS_TEXT[str(p['status'])]! }
        : null;
    case 'agent.session.ended':
      return {
        icon: Square,
        tone: 'muted',
        title: `Session ended${p['reason'] ? ` (${str(p['reason']).replaceAll('_', ' ')})` : ''}`,
      };
    case 'agent.output':
      if (p['role'] === 'user')
        return { icon: User, tone: 'accent', title: 'Instruction', body: str(p['text']), long: true };
      if (p['role'] === 'assistant')
        return { icon: Bot, tone: 'default', title: 'Claude', body: str(p['text']), long: true };
      return { icon: Flag, tone: 'muted', title: str(p['text']) };
    case 'agent.tool.started':
      return {
        icon: Wrench,
        tone: 'default',
        title: str(p['toolName']),
        body: toolTarget(p['input']),
        mono: true,
      };
    case 'agent.tool.completed':
      return {
        icon: CircleCheck,
        tone: 'success',
        title: `${str(p['toolName'])} finished`,
        ...(str(p['output']) ? { body: str(p['output']), mono: true, long: true } : {}),
      };
    case 'agent.tool.failed':
      return {
        icon: CircleX,
        tone: 'danger',
        title: `${str(p['toolName'])} failed`,
        body: str(p['error']),
        mono: true,
        long: true,
      };
    case 'agent.permission.requested':
      return {
        icon: ShieldAlert,
        tone: 'warning',
        title: `Permission requested: ${str(p['toolName'])}`,
        body: toolTarget(p['input']),
        mono: true,
      };
    case 'agent.permission.resolved':
      return {
        icon: ShieldCheck,
        tone: p['outcome'] === 'auto_denied' ? 'danger' : 'muted',
        title: OUTCOME[str(p['outcome'])] ?? 'Permission resolved',
      };
    case 'agent.error':
      return { icon: AlertTriangle, tone: 'danger', title: 'Error', body: str(p['message']) };
    default:
      return null;
  }
}

const TONE = {
  default: 'bg-muted text-foreground',
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  accent: 'bg-primary/10 text-primary',
} as const;

function Body({ text, mono, long }: { text: string; mono?: boolean; long?: boolean }) {
  const [open, setOpen] = useState(false);
  const clamp = long && text.length > 280 && !open;
  return (
    <div className="mt-1">
      <p
        className={cn(
          'text-sm break-words whitespace-pre-wrap',
          mono ? 'rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[12.5px]' : 'text-foreground/90',
          clamp && 'line-clamp-4',
        )}
      >
        {text}
      </p>
      {long && text.length > 280 && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export function Timeline({
  events,
  showSession = false,
}: {
  events: AgentEventDto[];
  showSession?: boolean;
}) {
  const items = events.map((e) => ({ e, v: describeEvent(e) })).filter((x) => x.v);
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ol className="flex flex-col" data-testid="timeline">
      {items.map(({ e, v }) => {
        const Icon = v!.icon;
        return (
          <li key={e.id} className="flex gap-3 py-2.5" data-event-type={e.eventType}>
            <span
              className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', TONE[v!.tone])}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'text-sm font-medium',
                    v!.tone === 'muted' && 'font-normal text-muted-foreground',
                  )}
                >
                  {v!.title}
                </span>
                {showSession && e.session && (
                  <Link
                    href={`/agents/${e.session.id}`}
                    className="truncate text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {e.session.projectName} · {e.session.deviceName}
                  </Link>
                )}
                <time
                  dateTime={e.createdAt}
                  className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {timeAgo(e.createdAt)}
                </time>
              </div>
              {v!.body && <Body text={v!.body} mono={v!.mono} long={v!.long} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
