'use client';

import { agentName } from '@pocket-agent/core';
import type { CommandStatus } from '@pocket-agent/protocol';
import {
  ArrowDown,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  Laptop,
  MessageCircleQuestion,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ClaudeSpinner } from '@/components/agents/claude-spinner';
import { SentAttachments } from '@/components/agents/attachments';
import { Markdown } from '@/components/agents/markdown';
import {
  isQueued,
  readAnswer,
  SHELL_TOOLS,
  summaryParts,
  TOOL_STATE,
  type AskedQuestion,
  type ChatItem,
} from '@/lib/chat';
import { commandError, controlText, STATUS_LABEL } from '@/lib/commands';
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

/** The chat's agent in a sentence ("Claude", "Codex"); given around the conversation. */
export const AgentName = createContext(agentName('claude-code'));

function UserMessage({ item }: { item: Of<'user'> }) {
  const c = item.command;
  const tick = c ? TICK[c.status] : null;
  const err = c ? commandError(c) : null;
  const long = item.text.length > FOLD_CHARS || item.text.split('\n').length > FOLD_LINES;
  const [open, setOpen] = useState(false);
  const status = c ? STATUS_LABEL[c.status] : null;
  return (
    <li
      className="flex min-w-0 flex-col items-end gap-1"
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
      <div className="user-prompt max-w-[88%] rounded-2xl rounded-tr-md px-3.5 py-2 sm:max-w-[80%]">
        {item.attachments && <SentAttachments files={item.attachments} />}
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
            className="mt-1 text-[13px] font-semibold underline underline-offset-2"
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
  const agent = useContext(AgentName);
  return (
    <Step dot="bg-muted-foreground/45">
      <time
        dateTime={item.at}
        className="absolute -top-4 right-0 text-[11px] leading-4 text-muted-foreground tabular-nums"
      >
        {clockTime(item.at)}
      </time>
      <span className="sr-only">{agent}:</span>
      <Markdown text={item.text} />
    </Step>
  );
}

const DOT: Record<Of<'tool'>['state'], string> = {
  running: 'bg-primary animate-pulse',
  done: 'bg-success',
  failed: 'bg-destructive',
};
/**
 * A tool call as Claude Code shows it. Shell commands get an IN/OUT block (one line of command,
 * the first lines of output, tap for all); other tools a single line: the name, then the file,
 * pattern or URL it used.
 */
function ToolStep({ item }: { item: Of<'tool'> }) {
  const [open, setOpen] = useState(false);
  const target = item.target || '';
  const output = item.output ?? '';
  const shell = SHELL_TOOLS.has(item.toolName);
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
          className="mt-1 block w-full overflow-hidden rounded-md bg-card text-left font-mono text-[12px] leading-[1.55] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
        const { chosen, own } = readAnswer(q, answer);
        return (
          <div key={qi} className="mt-3">
            {q.header && (
              <span className="mb-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {q.header}
              </span>
            )}
            <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">{q.question}</p>
            {q.multiSelect && <p className="mt-0.5 text-xs text-muted-foreground">Pick any</p>}
            <ul className="mt-1 divide-y">
              {q.options.map((o) => {
                const on = chosen.has(o.label);
                return (
                  <li
                    key={o.label}
                    className={cn(
                      // One card: options are rows split by dividers, the chosen one in the accent colour.
                      'flex gap-2.5 py-2.5',
                      on && 'text-primary',
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
            {own && (
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">Your answer: </span>
                {own}
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
      <div className="rounded-xl bg-card px-3 py-2.5">
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
/** One step of typing `to` over `from`: `i` letters are already the new word. */
export function typeOver(from: string, to: string, i: number): string {
  // First the new letters replace the old ones from the left…
  if (i <= to.length) return to.slice(0, i) + from.slice(i);
  // …then what is left of a longer old word is deleted from the end.
  return to + from.slice(to.length, Math.max(to.length, from.length - (i - to.length)));
}

const TYPE_STEP_MS = 55;

export function TypingIndicator({ kind, since }: { kind: 'working' | 'starting'; since: string | null }) {
  const agent = useContext(AgentName);
  const [start] = useState(() => (since ? Math.min(Date.parse(since), Date.now()) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  // What is on screen: mid-change it is part new word, part old.
  const [shown, setShown] = useState(() => VERBS[Math.floor(Math.random() * VERBS.length)]!);
  /** The verb being shown or typed towards. */
  const current = useRef(shown);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let typing: number | undefined;
    // Every few seconds the next verb is typed over the current one, like a typewriter.
    const words = window.setInterval(() => {
      const from = current.current;
      let to = from;
      while (to === from) to = VERBS[Math.floor(Math.random() * VERBS.length)]!;
      current.current = to;
      if (reduce) return setShown(to);
      let i = 0;
      const steps = Math.max(to.length, from.length);
      window.clearInterval(typing);
      typing = window.setInterval(() => {
        i += 1;
        setShown(typeOver(from, to, i));
        if (i >= steps) window.clearInterval(typing);
      }, TYPE_STEP_MS);
    }, 3500);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(words);
      window.clearInterval(typing);
    };
  }, []);

  const word = kind === 'starting' ? 'Starting' : shown;
  return (
    <div className="flex items-center gap-2 py-1 text-sm" role="status" data-testid="typing-indicator">
      <ClaudeSpinner className="text-base text-primary" />
      <span className="shimmer-text font-medium" aria-hidden>
        {word}…
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">({elapsed(now - start)})</span>
      <span className="sr-only">{agent} is working</span>
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
      case 'thought':
        out.push(
          <Step key={item.key} dot="bg-muted-foreground/30" data-testid="thought">
            <p className="text-[13.5px] leading-[1.6] text-muted-foreground">{item.text}</p>
          </Step>,
        );
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
      case 'summary':
        out.push(<TurnSummary key={item.key} item={item} />);
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
  const queued = items.filter((i): i is Of<'user'> => isQueued(i));
  const said = queued.length ? items.filter((i) => !isQueued(i)) : items;
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
        {/* pb-14: the last message clears the fade above the message box (h-10) with room to spare. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-4 pb-14 sm:px-6">
          {header}
          {items.length ? (
            <ol
              className="content-in flex flex-col gap-4"
              data-testid="timeline"
              aria-label="Conversation"
              {...(settled ? { 'data-enter-new': '' } : {})}
            >
              {renderItems(said)}
            </ol>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="timeline">
              No messages yet.
            </p>
          )}
          {typing && (
            <TypingIndicator kind={typing} since={said.findLast((i) => i.kind === 'user')?.at ?? null} />
          )}
          {/* Sent but not picked up yet: these stay under everything until Claude takes them. */}
          {queued.length > 0 && (
            <ol
              className="flex flex-col gap-3"
              aria-label="Waiting to be delivered"
              data-testid="queued"
              data-enter-new=""
            >
              {queued.map((item) => (
                <UserMessage key={item.key} item={item} />
              ))}
            </ol>
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

/**
 * Claude finished a turn: how long it took, the files it changed and the commands it ran, at a
 * glance (the steps themselves are above). A long file list folds.
 */
function TurnSummary({ item }: { item: Extract<ChatItem, { kind: 'summary' }> }) {
  const agent = useContext(AgentName);
  const [open, setOpen] = useState(false);
  const parts = summaryParts(item);
  const [first, ...rest] = parts;
  const FOLDED = 3;
  const shown = open ? item.files : item.files.slice(0, FOLDED);
  return (
    <div
      data-testid="turn-summary"
      aria-label={`${agent} finished: ${parts.join(', ')}`}
      className="rounded-xl border bg-card px-4 py-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <CircleCheck
          className={cn('size-4 shrink-0', item.failed ? 'text-amber-500' : 'text-emerald-600')}
          aria-hidden
        />
        <span className="shrink-0 font-medium">Done in {first}</span>
        {rest.length > 0 && <span className="truncate text-muted-foreground">· {rest.join(' · ')}</span>}
      </div>
      {shown.length > 0 && (
        <ul className="mt-2 space-y-0.5 pl-6 font-mono text-[12.5px]">
          {shown.map((f) => {
            const parts = f.split(/[\\/]/).filter(Boolean);
            return (
              <li key={f} className="truncate" title={f}>
                {parts.at(-1)}
                <span className="text-muted-foreground"> {parts.slice(-3, -1).join('/')}</span>
              </li>
            );
          })}
          {item.files.length > FOLDED && (
            <li>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="font-sans text-xs font-medium text-primary hover:underline"
              >
                {open ? 'Show less' : `${item.files.length - FOLDED} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
