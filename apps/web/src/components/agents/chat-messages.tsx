'use client';

import type { CommandDto, CommandStatus } from '@pocket-agent/protocol';
import {
  ArrowDown,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock,
  Laptop,
  MessageCircleQuestion,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ClaudeSpinner } from '@/components/agents/claude-spinner';
import { Markdown } from '@/components/agents/markdown';
import type { ChatItem } from '@/lib/chat';
import { commandError, STATUS_LABEL } from '@/lib/commands';
import { clockTime, dayLabel, daysAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

const TICK: Record<CommandStatus, { Icon: typeof Check; cls: string }> = {
  Pending: { Icon: Clock, cls: 'text-(--bubble-meta)' },
  Delivered: { Icon: Check, cls: 'text-(--bubble-meta)' },
  Accepted: { Icon: CheckCheck, cls: 'text-(--bubble-meta)' },
  Executing: { Icon: CheckCheck, cls: 'text-(--bubble-link)' },
  Completed: { Icon: CheckCheck, cls: 'text-(--bubble-read)' },
  Failed: { Icon: CircleAlert, cls: 'text-destructive' },
  Expired: { Icon: Clock, cls: 'text-destructive' },
};

/** Long messages are folded, like a messenger's "Read more". */
const FOLD_CHARS = 700;
const FOLD_LINES = 12;

function UserMessage({ item }: { item: Of<'user'> }) {
  const c = item.command;
  const tick = c ? TICK[c.status] : null;
  const err = c ? commandError(c) : null;
  const long = item.text.length > FOLD_CHARS || item.text.split('\n').length > FOLD_LINES;
  const [open, setOpen] = useState(false);
  const status = c ? STATUS_LABEL[c.status] : null;
  return (
    <li
      className="flex flex-col items-end gap-1 pr-2 pl-10 sm:pl-20"
      {...(c ? { 'data-testid': 'command-row', 'data-status': c.status } : {})}
    >
      <div className="bubble-out relative max-w-full px-2.5 pt-1.5 pb-2">
        <p
          className={cn(
            'text-[14.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap',
            long && !open && 'line-clamp-[12]',
          )}
        >
          {item.text}
          {/* Room for the time on the last line, like a messenger. */}
          <span aria-hidden className="inline-block w-[84px]" />
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-0.5 text-[13px] font-semibold text-(--bubble-link) hover:underline"
          >
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
        <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-(--bubble-meta) tabular-nums">
          {c ? (
            <Smartphone className="size-3" aria-label="Sent from Pocket Agent" />
          ) : (
            <Laptop className="size-3" aria-label="Typed on the PC" />
          )}
          <time dateTime={item.at}>{clockTime(item.at)}</time>
          {tick && (
            <span title={status ?? undefined} className="inline-flex">
              <tick.Icon className={cn('size-4', tick.cls)} aria-hidden />
            </span>
          )}
        </span>
        {status && !err && <span className="sr-only">{status}</span>}
      </div>
      {err && <p className="px-1 text-[11px] text-destructive">{err}</p>}
    </li>
  );
}

function AssistantMessage({ item }: { item: Of<'assistant'> }) {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="sr-only">Claude:</span>
      <Markdown text={item.text} />
      <time dateTime={item.at} className="text-[11px] text-muted-foreground tabular-nums">
        {clockTime(item.at)}
      </time>
    </li>
  );
}

const DOT: Record<Of<'tool'>['state'], string> = {
  running: 'bg-primary animate-pulse',
  done: 'bg-success',
  failed: 'bg-destructive',
};
const TOOL_STATE: Record<Of<'tool'>['state'], string> = {
  running: 'running',
  done: 'finished',
  failed: 'failed',
};

function ToolRow({ item }: { item: Of<'tool'> }) {
  const [open, setOpen] = useState(false);
  const expandable = !!item.output;
  return (
    <div data-tool-state={item.state}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] outline-none enabled:hover:bg-accent/50 focus-visible:bg-accent/60"
      >
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[item.state])} />
        <span className="shrink-0 font-medium">{item.toolName}</span>
        <span className="sr-only">{` ${TOOL_STATE[item.state]} `}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
          {item.target}
        </span>
        {expandable && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </button>
      {open && (
        <pre
          className={cn(
            'mx-3 mb-2.5 max-h-72 overflow-auto rounded-md bg-muted/70 px-2.5 py-2 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap',
            item.state === 'failed' && 'text-destructive',
          )}
        >
          {item.output}
        </pre>
      )}
    </div>
  );
}

function ToolGroup({ items }: { items: Of<'tool'>[] }) {
  return (
    <li className="min-w-0">
      <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {items.map((t) => (
          <ToolRow key={t.key} item={t} />
        ))}
      </div>
    </li>
  );
}

const QUESTION_STATE = {
  running: { text: 'Waiting for your answer on the PC', cls: 'text-primary' },
  done: { text: 'Answered', cls: 'text-success' },
  failed: { text: 'Declined', cls: 'text-muted-foreground' },
} as const;

/** Claude asking the user something (AskUserQuestion), shown like the question card in VS Code. */
function QuestionCard({ item }: { item: Of<'question'> }) {
  const st = QUESTION_STATE[item.state];
  return (
    <li className="min-w-0" data-testid="question-card" data-state={item.state}>
      <div className="rounded-xl border bg-card px-3.5 py-3 shadow-xs">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4 shrink-0 text-primary" aria-hidden />
          <p className="text-[13px] font-semibold">
            {item.questions.length > 1 ? `${item.questions.length} questions` : 'Question'}
          </p>
          <span className={cn('ml-auto text-right text-xs font-medium', st.cls)}>{st.text}</span>
        </div>
        {item.questions.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Claude asked you a question. Update Pocket Agent on the PC to see it here.
          </p>
        )}
        {item.questions.map((q, qi) => {
          const answer = item.answers[q.question];
          const chosen = new Set(answer ? answer.split(',').map((a) => a.trim()) : []);
          const other = !!answer && !q.options.some((o) => chosen.has(o.label));
          return (
            <div key={qi} className="mt-3 rounded-lg border bg-muted/30 p-3">
              {q.header && (
                <span className="mb-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                  {q.header}
                </span>
              )}
              <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">{q.question}</p>
              {q.multiSelect && <p className="mt-0.5 text-xs text-muted-foreground">Pick any</p>}
              <ul className="mt-2 flex flex-col gap-1.5">
                {q.options.map((o) => {
                  const on = chosen.has(o.label);
                  return (
                    <li
                      key={o.label}
                      className={cn(
                        'flex gap-2.5 rounded-lg border px-3 py-2',
                        on ? 'border-primary/50 bg-primary/10' : 'bg-card',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 grid size-4 shrink-0 place-items-center border',
                          q.multiSelect ? 'rounded' : 'rounded-full',
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/40',
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium [overflow-wrap:anywhere]">
                          {o.label}
                          {on && <span className="sr-only"> (chosen)</span>}
                        </p>
                        {o.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {o.description}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {other && (
                <p className="mt-2 text-xs">
                  <span className="text-muted-foreground">Your answer: </span>
                  {answer}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
}

function PermissionRow({ item }: { item: Of<'permission'> }) {
  return (
    <li className="min-w-0">
      <div className="rounded-xl border border-warning/35 bg-card px-3 py-2.5 shadow-xs">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
          Permission requested: {item.toolName}
        </p>
        {item.target && (
          <p className="mt-1.5 rounded-md bg-muted/70 px-2 py-1 font-mono text-[12px] break-all">
            {item.target}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">{item.outcome ?? 'Waiting for a decision…'}</p>
      </div>
    </li>
  );
}

function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' }) {
  return (
    <li className="flex justify-center">
      <span
        className={cn(
          'max-w-[90%] rounded-full px-3 py-1 text-center text-xs',
          tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
        )}
      >
        {children}
      </span>
    </li>
  );
}

function controlText(c: CommandDto): string {
  const what = c.commandType === 'interrupt' ? 'You interrupted Claude' : 'You ended the session';
  return `${what} · ${commandError(c) ?? STATUS_LABEL[c.status]}`;
}

function DaySeparator({ at }: { at: string }) {
  return (
    <li className="flex items-center gap-3 py-1" aria-label={dayLabel(at)}>
      <span aria-hidden className="wavy-rule flex-1" />
      <span className="text-xs font-medium text-muted-foreground">{dayLabel(at)}</span>
      <span aria-hidden className="wavy-rule flex-1" />
    </li>
  );
}

const VERBS = [
  'Churning',
  'Perusing',
  'Forming',
  'Herding',
  'Cooking',
  'Pondering',
  'Brewing',
  'Mulling',
  'Crafting',
  'Tinkering',
  'Percolating',
  'Conjuring',
  'Simmering',
  'Whirring',
  'Ruminating',
  'Noodling',
  'Musing',
  'Computing',
  'Spinning',
  'Wrangling',
  'Marinating',
  'Synthesizing',
];

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * "✻ Churning… (12s)" — a breathing star, a rotating verb and shimmering text while Claude works.
 * All the ticking lives in this tiny component, so the conversation itself never re-renders for it.
 */
export function TypingIndicator({ kind, since }: { kind: 'working' | 'starting'; since: string | null }) {
  const [verb, setVerb] = useState(() => VERBS[Math.floor(Math.random() * VERBS.length)]!);
  const [start] = useState(() => (since ? Math.min(Date.parse(since), Date.now()) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    // Swap the verb in two steps: the old one fades/blurs out, then the new one comes in.
    let swap: number | undefined;
    const words = window.setInterval(() => {
      setLeaving(true);
      swap = window.setTimeout(() => {
        setVerb((v) => {
          let next = v;
          while (next === v) next = VERBS[Math.floor(Math.random() * VERBS.length)]!;
          return next;
        });
        setLeaving(false);
      }, 260);
    }, 3500);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(words);
      window.clearTimeout(swap);
    };
  }, []);

  const word = kind === 'starting' ? 'Starting' : verb;
  return (
    <div className="flex items-center gap-2 py-1 text-sm" role="status" data-testid="typing-indicator">
      <ClaudeSpinner className="text-base text-primary" />
      <span
        key={word}
        className={cn(
          'shimmer-text verb-swap font-medium',
          leaving && 'translate-y-[-3px] opacity-0 blur-[2px]',
        )}
      >
        {word}…
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">({elapsed(now - start)})</span>
      <span className="sr-only">Claude is working</span>
    </div>
  );
}

/** Groups runs of tool calls together and inserts a separator whenever the day changes. */
function renderItems(items: ChatItem[]): ReactNode[] {
  const out: ReactNode[] = [];
  let lastDay: number | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const day = daysAgo(item.at);
    if (day !== lastDay) {
      out.push(<DaySeparator key={`day-${item.key}`} at={item.at} />);
      lastDay = day;
    }
    switch (item.kind) {
      case 'user':
        out.push(<UserMessage key={item.key} item={item} />);
        break;
      case 'assistant':
        out.push(<AssistantMessage key={item.key} item={item} />);
        break;
      case 'tool': {
        const group = [item];
        while (items[i + 1]?.kind === 'tool' && daysAgo(items[i + 1]!.at) === day) {
          group.push(items[++i] as Of<'tool'>);
        }
        out.push(<ToolGroup key={item.key} items={group} />);
        break;
      }
      case 'question':
        out.push(<QuestionCard key={item.key} item={item} />);
        break;
      case 'permission':
        out.push(<PermissionRow key={item.key} item={item} />);
        break;
      case 'control':
        out.push(<Pill key={item.key}>{controlText(item.command)}</Pill>);
        break;
      case 'notice':
        out.push(
          <Pill key={item.key} tone={item.tone}>
            {item.text}
          </Pill>,
        );
        break;
    }
  }
  return out;
}

/**
 * The scrolling conversation. Sticks to the bottom while you are there (new messages scroll into
 * view); scrolled up, it stays put and offers a jump back. Loading older messages keeps your place.
 */
export function ChatMessages({
  items,
  typing,
  header,
  footer,
}: {
  items: ChatItem[];
  typing: 'working' | 'starting' | null;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prev = useRef<{ first: string | null; height: number }>({ first: null, height: 0 });
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = items[0]?.key ?? null;
    if (prev.current.first && first !== prev.current.first && !atBottom.current) {
      el.scrollTop += el.scrollHeight - prev.current.height; // older messages were added on top
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { first, height: el.scrollHeight };
  }, [items, typing]);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAway(!atBottom.current);
        }}
        className="relative h-full overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
          {header}
          {items.length ? (
            <ol className="flex flex-col gap-4" data-testid="timeline" aria-label="Conversation">
              {renderItems(items)}
            </ol>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="timeline">
              No messages yet.
            </p>
          )}
          {typing && (
            <TypingIndicator kind={typing} since={items.findLast((i) => i.kind === 'user')?.at ?? null} />
          )}
          {footer}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={toBottom}
          aria-label="Scroll to latest"
          className="absolute right-4 bottom-3 grid size-10 place-items-center rounded-full border bg-popover text-muted-foreground shadow-md outline-none transition-colors animate-in fade-in-0 zoom-in-90 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowDown className="size-4.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
