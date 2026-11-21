'use client';

import type { CommandDto, CommandStatus } from '@pocket-agent/protocol';
import {
  ArrowDown,
  Check,
  CheckCheck,
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
import type { AskedQuestion, ChatItem } from '@/lib/chat';
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
      className="flex min-w-0 flex-col gap-1"
      {...(c ? { 'data-testid': 'command-row', 'data-status': c.status } : {})}
    >
      {/* As in Claude Code: the time above, the prompt in a quiet box. */}
      <span className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground tabular-nums">
        {c ? (
          <Smartphone className="size-3" aria-label="Sent from Pocket Agent" />
        ) : (
          <Laptop className="size-3" aria-label="Typed on the PC" />
        )}
        <time dateTime={item.at}>{clockTime(item.at)}</time>
        {tick && (
          <span title={status ?? undefined} className="inline-flex">
            <tick.Icon className={cn('size-3.5', tick.cls)} aria-hidden />
          </span>
        )}
      </span>
      <div className="user-prompt rounded-lg border px-3 py-2">
        <p
          className={cn(
            'text-[14px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap',
            long && !open && 'line-clamp-[12]',
          )}
        >
          {item.text}
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-1 text-[13px] font-medium text-primary hover:underline"
          >
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
        {status && !err && <span className="sr-only">{status}</span>}
      </div>
      {err && <p className="text-right text-[11px] text-destructive">{err}</p>}
    </li>
  );
}

/**
 * One step of Claude's side of the conversation, drawn like the editor: a dot on a vertical line
 * that joins consecutive steps.
 */
function Step({
  dot,
  children,
  className,
  ...rest
}: {
  dot: string;
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <li className={cn('step min-w-0', className)} {...rest}>
      <span aria-hidden className={cn('step-dot', dot)} />
      {children}
    </li>
  );
}

function AssistantMessage({ item }: { item: Of<'assistant'> }) {
  return (
    <Step dot="bg-muted-foreground/45">
      <time
        dateTime={item.at}
        className="absolute -top-4 right-0 text-[11px] leading-4 text-muted-foreground tabular-nums"
      >
        {clockTime(item.at)}
      </time>
      <span className="sr-only">Claude:</span>
      <Markdown text={item.text} />
    </Step>
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

const SHELL = new Set(['Bash', 'PowerShell', 'BashOutput']);

/**
 * A tool call as Claude Code shows it. Shell commands get an IN/OUT block (one line of command,
 * the first lines of output, tap for all); other tools a single line: the name, then the file,
 * pattern or URL it used.
 */
function ToolStep({ item }: { item: Of<'tool'> }) {
  const [open, setOpen] = useState(false);
  const target = item.target || '';
  const output = item.output ?? '';
  const shell = SHELL.has(item.toolName);
  const block = shell ? !!(target || output) : !!output;
  const more = shell && (target.length > 48 || target.includes('\n') || output.split('\n').length > 3);
  return (
    <Step dot={DOT[item.state]} data-tool-state={item.state}>
      <p className="flex min-w-0 items-baseline gap-2 text-[14px] leading-[1.6]">
        <span className="shrink-0 font-semibold">{item.toolName}</span>
        <span className="sr-only">{` ${TOOL_STATE[item.state]} `}</span>
        {!shell && target && (
          <span className="min-w-0 truncate font-mono text-[12.5px] text-(--tool-link)">{target}</span>
        )}
      </p>
      {block && (
        <button
          type="button"
          disabled={!more}
          aria-expanded={more ? open : undefined}
          aria-label={more ? (open ? 'Show less' : 'Show more') : undefined}
          onClick={() => setOpen(!open)}
          className="mt-1 block w-full overflow-hidden rounded-md border bg-card text-left font-mono text-[12px] leading-[1.55] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {shell && target && (
            <span className="flex gap-3 px-2.5 py-1.5">
              <span className="w-7 shrink-0 font-sans text-[10.5px] leading-[1.9] font-semibold text-muted-foreground">
                IN
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1',
                  open ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'truncate',
                )}
              >
                {target}
              </span>
            </span>
          )}
          {output && (
            <span className={cn('flex gap-3 px-2.5 py-1.5', shell && target && 'border-t')}>
              <span className="w-7 shrink-0 font-sans text-[10.5px] leading-[1.9] font-semibold text-muted-foreground">
                OUT
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]',
                  open ? 'max-h-80 overflow-y-auto' : 'tool-out-fold',
                  item.state === 'failed' && 'text-destructive',
                )}
              >
                {output}
              </span>
            </span>
          )}
        </button>
      )}
    </Step>
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
    <Step dot="bg-primary" data-testid="question-card" data-state={item.state}>
      <div className="rounded-xl bg-card px-3.5 py-3">
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
        <AskedQuestions questions={item.questions} answers={item.answers} />
      </div>
    </Step>
  );
}

/** Claude's questions with their options (and the chosen answers, once known). */
export function AskedQuestions({
  questions,
  answers = {},
}: {
  questions: AskedQuestion[];
  answers?: Record<string, string>;
}) {
  return (
    <>
      {questions.map((q, qi) => {
        const answer = answers[q.question];
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
    </>
  );
}

function PermissionRow({ item }: { item: Of<'permission'> }) {
  return (
    <Step dot="bg-warning">
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
    </Step>
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
      case 'tool':
        out.push(<ToolStep key={item.key} item={item} />);
        break;
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
  // Only messages that arrive after the first render animate in; the history is just there.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(t);
  }, []);
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
            <ol
              className="content-in flex flex-col gap-4"
              data-testid="timeline"
              aria-label="Conversation"
              {...(settled ? { 'data-enter-new': '' } : {})}
            >
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
