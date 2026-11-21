'use client';

import { ApprovalResponse, type ApprovalDto } from '@pocket-agent/protocol';
import { Clock, Send } from 'lucide-react';
import { useState } from 'react';
import { answerText, useCountdown, type Pick } from '@/components/approvals/approval-card';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import type { AskedQuestion } from '@/lib/chat';
import { mmss } from '@/lib/format';
import { cn } from '@/lib/utils';

const NO_PICK: Pick = { labels: [], other: '' };
const OTHER = '\u0000other';

function Option({
  selected,
  multi,
  title,
  hint,
  onSelect,
  children,
}: {
  selected: boolean;
  multi: boolean;
  title: string;
  hint?: string;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className={cn('transition-colors', selected && 'bg-primary/10')}>
      <button
        type="button"
        role={multi ? 'checkbox' : 'radio'}
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:bg-accent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold [overflow-wrap:anywhere]">{title}</span>
          {hint && (
            <span className="mt-0.5 block text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
              {hint}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={cn(
            'grid size-6 shrink-0 place-items-center border-2 transition-colors',
            multi ? 'rounded-md' : 'rounded-full',
            selected ? 'border-primary bg-primary' : 'border-muted-foreground/45',
          )}
        >
          {selected && (
            <span
              className={cn('bg-primary-foreground', multi ? 'size-2.5 rounded-sm' : 'size-2 rounded-full')}
            />
          )}
        </span>
      </button>
      {children}
    </li>
  );
}

function QuestionBlock({
  q,
  pick,
  onPick,
  disabled,
  timer,
}: {
  q: AskedQuestion;
  pick: Pick;
  onPick: (p: Pick) => void;
  disabled: boolean;
  timer?: React.ReactNode;
}) {
  const otherOn = pick.labels.includes(OTHER);
  const choose = (label: string) => {
    if (q.multiSelect) {
      const on = pick.labels.includes(label);
      onPick({ ...pick, labels: on ? pick.labels.filter((l) => l !== label) : [...pick.labels, label] });
    } else {
      onPick({ labels: [label], other: label === OTHER ? pick.other : '' });
    }
  };
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{q.question}</legend>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">
          {q.header || 'Claude is asking'}
        </span>
        {timer}
      </div>
      <p className="mt-1.5 text-lg leading-snug font-semibold text-pretty [overflow-wrap:anywhere]">
        {q.question}
      </p>
      {q.multiSelect && <p className="mt-0.5 text-sm text-muted-foreground">Pick any</p>}
      <ul
        role={q.multiSelect ? 'group' : 'radiogroup'}
        aria-label={q.question}
        className="mt-3 divide-y overflow-hidden rounded-2xl border bg-card"
      >
        {q.options.map((o) => (
          <Option
            key={o.label}
            selected={pick.labels.includes(o.label)}
            multi={q.multiSelect}
            title={o.label}
            {...(o.description ? { hint: o.description } : {})}
            onSelect={() => choose(o.label)}
          />
        ))}
        <Option
          selected={otherOn}
          multi={q.multiSelect}
          title="Other"
          hint="Type your own answer"
          onSelect={() => choose(OTHER)}
        >
          {otherOn && (
            <div className="px-4 pb-3.5">
              <label className="sr-only" htmlFor={`other-${q.question}`}>
                Your own answer
              </label>
              <input
                id={`other-${q.question}`}
                autoFocus
                maxLength={300}
                value={pick.other}
                onChange={(e) => onPick({ ...pick, other: e.target.value })}
                placeholder="Your answer"
                className="h-11 w-full rounded-xl border bg-background px-3 text-base outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
            </div>
          )}
        </Option>
      </ul>
    </fieldset>
  );
}

/**
 * Claude's question, docked at the bottom of the chat in place of the message box: pick an
 * option (or type your own), then send. Skip lets Claude carry on without an answer.
 */
export function QuestionSheet({
  approval,
  questions,
  onDone,
}: {
  approval: ApprovalDto;
  questions: AskedQuestion[];
  onDone: () => void;
}) {
  const left = useCountdown(approval.expiresAt);
  const expired = left <= 0;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState<'send' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Other" is a choice of its own; what Claude receives is the typed words.
  const answers = Object.fromEntries(
    questions.map((q) => {
      const p = picks[q.question] ?? NO_PICK;
      const labels = p.labels.filter((l) => l !== OTHER);
      return [q.question, answerText(q, { labels, other: p.labels.includes(OTHER) ? p.other : '' })];
    }),
  );
  const complete = questions.every((q) => answers[q.question]);

  async function decide(decision: 'allow' | 'deny') {
    setBusy(decision === 'allow' ? 'send' : 'skip');
    setError(null);
    try {
      await apiRequest(`/approvals/${approval.id}/decision`, ApprovalResponse, {
        method: 'POST',
        body:
          decision === 'allow'
            ? { decision, answers }
            : { decision, message: 'The user skipped this question.' },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const timer = (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
      <Clock className="size-3.5 text-primary" aria-hidden />
      {expired ? (
        'Expired'
      ) : (
        <>
          <span className="font-semibold text-foreground">{mmss(left)}</span> left
        </>
      )}
    </span>
  );

  return (
    <section
      aria-label="Claude is asking you"
      data-testid="question-sheet"
      className="sheet-in flex max-h-[70dvh] flex-col overflow-hidden rounded-t-3xl border-t-[3px] border-primary bg-popover"
    >
      <div className="flex flex-col gap-6 overflow-y-auto px-4 pt-4 pb-2">
        {questions.map((q, i) => (
          <QuestionBlock
            key={q.question}
            q={q}
            pick={picks[q.question] ?? NO_PICK}
            onPick={(p) => setPicks((prev) => ({ ...prev, [q.question]: p }))}
            disabled={!!busy || expired}
            {...(i === 0 ? { timer } : {})}
          />
        ))}
      </div>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <p className="text-xs text-muted-foreground">
          Sent straight to your PC. If the timer runs out, Claude carries on without it.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button
            variant="outline"
            className="h-12 rounded-xl bg-transparent px-5"
            disabled={!!busy || expired}
            onClick={() => void decide('deny')}
          >
            {busy === 'skip' ? 'Skipping…' : 'Skip'}
          </Button>
          <Button
            className="h-12 rounded-xl"
            disabled={!!busy || expired || !complete}
            onClick={() => void decide('allow')}
          >
            <Send aria-hidden />
            {busy === 'send' ? 'Sending…' : complete ? 'Send answer' : 'Choose an answer'}
          </Button>
        </div>
      </div>
    </section>
  );
}
