'use client';

import { ApprovalResponse, type ApprovalDto } from '@pocket-agent/protocol';
import { Check, CheckCheck, Clock, MessageCircleQuestion, Send, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { agentName, parseQuestions, requestTarget, type AskedQuestion } from '@/lib/chat';
import { Button } from '@/components/ui/button';
import { shellTokens } from '@/components/ui/command-line';
import { apiRequest } from '@/lib/api';
import { mmss, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export const APPROVAL_STATUS: Record<
  ApprovalDto['status'],
  { label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' | 'accent' }
> = {
  Pending: { label: 'Waiting', tone: 'warning' },
  Approved: { label: 'Allowed', tone: 'success' },
  Denied: { label: 'Denied', tone: 'danger' },
  Expired: { label: 'Expired', tone: 'neutral' },
  Cancelled: { label: 'Answered elsewhere', tone: 'neutral' },
};

/** What the request is, in plain words. */
export function describeRequest(tool: string): { verb: string; label: string; shell: boolean } {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return { verb: 'run a command', label: 'Command', shell: true };
    case 'Write':
      return { verb: 'create or overwrite a file', label: 'File', shell: false };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'edit a file', label: 'File', shell: false };
    case 'WebFetch':
      return { verb: 'open a web page', label: 'URL', shell: false };
    case 'Sandbox':
      return { verb: 'go beyond its sandbox', label: 'Access', shell: false };
    case 'AskUserQuestion':
      return { verb: 'ask you a question', label: 'Question', shell: false };
    default:
      return { verb: `use ${tool}`, label: 'Details', shell: false };
  }
}

/** Tools the PC only describes by argument names (MCP and unknown tools): show them as a list. */
export function readableInput(input: string): string {
  try {
    const v = JSON.parse(input) as Record<string, unknown>;
    const args = v['arguments'];
    if (Array.isArray(args) && Object.keys(v).length === 1) {
      return args.length ? `Arguments: ${args.join(', ')}` : 'No arguments';
    }
    return JSON.stringify(v, null, 2);
  } catch {
    return input;
  }
}

export function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.parse(expiresAt) - now;
}

/** What the user picked for one question: option labels, and/or their own words. */
export interface Pick {
  labels: string[];
  other: string;
}
const NO_PICK: Pick = { labels: [], other: '' };

/** The answer Claude receives: labels (comma-separated for several), or the user's own words. */
export function answerText(q: AskedQuestion, pick: Pick | undefined): string {
  const p = pick ?? NO_PICK;
  const other = p.other.trim();
  // Keep Claude's option order, whatever order they were tapped in.
  const labels = q.options.map((o) => o.label).filter((l) => p.labels.includes(l));
  return [...labels, ...(other ? [other] : [])].join(', ');
}

/** Claude's questions with tappable options: one choice (or several, if Claude allows) plus free text. */
function QuestionForm({
  questions,
  picks,
  onPick,
  disabled,
}: {
  questions: AskedQuestion[];
  picks: Record<string, Pick>;
  onPick: (question: string, pick: Pick) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {questions.map((q, qi) => {
        const pick = picks[q.question] ?? NO_PICK;
        const toggle = (label: string) => {
          if (q.multiSelect) {
            const on = pick.labels.includes(label);
            onPick(q.question, {
              ...pick,
              labels: on ? pick.labels.filter((l) => l !== label) : [...pick.labels, label],
            });
          } else {
            // One choice: picking an option replaces a typed answer, and the other way round.
            onPick(q.question, { labels: [label], other: '' });
          }
        };
        return (
          <fieldset key={qi} disabled={disabled} className="rounded-xl border bg-muted/30 p-3">
            <legend className="sr-only">{q.question}</legend>
            {q.header && (
              <span className="mb-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {q.header}
              </span>
            )}
            <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">{q.question}</p>
            {q.multiSelect && <p className="mt-0.5 text-xs text-muted-foreground">Pick any</p>}
            <div
              role={q.multiSelect ? 'group' : 'radiogroup'}
              aria-label={q.question}
              className="mt-2 flex flex-col gap-1.5"
            >
              {q.options.map((o) => {
                const on = pick.labels.includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(o.label)}
                    className={cn(
                      'flex min-h-11 w-full gap-2.5 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
                      on ? 'border-primary bg-primary/10' : 'bg-card hover:border-foreground/25',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors',
                        q.multiSelect ? 'rounded' : 'rounded-full',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/50',
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium [overflow-wrap:anywhere]">
                        {o.label}
                      </span>
                      {o.description && (
                        <span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {o.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="mt-2 block">
              <span className="sr-only">Your own answer to: {q.question}</span>
              <input
                type="text"
                value={pick.other}
                maxLength={300}
                placeholder="Other: type your own answer"
                onChange={(e) =>
                  onPick(q.question, {
                    labels: q.multiSelect || !e.target.value ? pick.labels : [],
                    other: e.target.value,
                  })
                }
                className="h-10 w-full rounded-lg border bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
              />
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}

/** One pending permission request, with everything needed to decide on a phone. */
export function ApprovalCard({ approval, onDecided }: { approval: ApprovalDto; onDecided: () => void }) {
  const left = useCountdown(approval.expiresAt);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'allow' | 'deny' | null>(approval.decision);
  // Allowed with "don't ask again in this session" (the PC offers it for some requests).
  const [forSession, setForSession] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const target = requestTarget(approval.toolName, approval.input);
  const expired = left <= 0;

  async function decide(decision: 'allow' | 'deny', extra: Record<string, unknown> = {}) {
    setBusy(decision);
    setForSession(extra['remember'] === true);
    setError(null);
    try {
      await apiRequest(`/approvals/${approval.id}/decision`, ApprovalResponse, {
        method: 'POST',
        body: { decision, ...extra },
      });
      setSent(decision);
      onDecided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const what = describeRequest(approval.toolName);
  const shown = target || readableInput(approval.input);
  const asking = approval.toolName === 'AskUserQuestion';
  const questions = asking ? parseQuestions(approval.input) : [];
  // Claude's question: answered right here (the options are the buttons), not allowed or denied.
  const answering = asking && questions.length > 0;
  const answers = Object.fromEntries(questions.map((q) => [q.question, answerText(q, picks[q.question])]));
  const complete = answering && questions.every((q) => answers[q.question]);
  return (
    <article
      className="flex flex-col overflow-hidden rounded-2xl bg-card"
      data-testid="approval-card"
      data-request-id={approval.requestId}
    >
      <header
        className={cn(
          'flex items-start gap-3 border-b px-4 py-3',
          answering ? 'bg-primary/8' : 'bg-warning/8',
        )}
      >
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            answering ? 'bg-primary/15 text-primary' : 'bg-warning/20 text-warning',
          )}
        >
          {answering ? (
            <MessageCircleQuestion className="size-4.5" aria-hidden />
          ) : (
            <ShieldAlert className="size-4.5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold">
            {answering
              ? `${agentName(approval.provider)} is asking you`
              : `${agentName(approval.provider)} wants to ${what.verb}`}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <Link
              href={`/agents/${approval.sessionId}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {approval.projectName}
            </Link>{' '}
            · {approval.deviceName} · {timeAgo(approval.createdAt)}
          </p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
            expired ? 'bg-muted text-muted-foreground' : 'bg-warning/15 text-warning',
          )}
          aria-live="off"
          title="Time left to decide"
        >
          <Clock className="size-3" aria-hidden />
          {expired ? 'Expired' : mmss(left)}
        </span>
      </header>

      {answering ? (
        <div className="flex flex-col gap-2 px-4 py-3" data-testid="approval-questions">
          <QuestionForm
            questions={questions}
            picks={picks}
            onPick={(q, pick) => setPicks((prev) => ({ ...prev, [q]: pick }))}
            disabled={!!busy || !!sent || expired}
          />
          <p className="text-xs text-muted-foreground">
            Your answer goes straight to Claude on your PC. Not answered in time: Claude carries on without
            it.
          </p>
        </div>
      ) : (
        // Exactly what will run: the decision applies to this, unchanged.
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {what.label} · {approval.toolName}
          </p>
          {asking ? (
            <p
              className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
              data-testid="approval-questions"
            >
              Update Pocket Agent on your PC to see and answer Claude&apos;s question here.
            </p>
          ) : (
            <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {what.shell
                ? shellTokens(shown).map((t, i) => (
                    <span key={i} className={t.cls}>
                      {t.text}
                    </span>
                  ))
                : shown}
            </pre>
          )}
          <p className="text-xs text-muted-foreground">
            {approval.sessionMode === 'managed'
              ? 'If nobody decides in time, it is denied.'
              : 'If nobody decides in time, Claude Code asks on your PC instead.'}
          </p>
        </div>
      )}

      <div className="border-t bg-muted/30 px-4 py-3">
        {sent ? (
          <p className="text-sm text-muted-foreground" role="status">
            {answering
              ? sent === 'allow'
                ? 'Answer sent. Waiting for your PC to confirm…'
                : 'Skipped. Waiting for your PC to confirm…'
              : `${sent === 'allow' ? (forSession ? 'Allowed for this session' : 'Allowed') : 'Denied'} — waiting for your PC to confirm…`}
          </p>
        ) : answering ? (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              variant="outline"
              className="h-11 bg-card"
              disabled={!!busy || expired}
              onClick={() => void decide('deny', { message: 'The user skipped this question.' })}
            >
              {busy === 'deny' ? 'Skipping…' : 'Skip'}
            </Button>
            <Button
              className="h-11"
              disabled={!!busy || expired || !complete}
              title={complete ? undefined : 'Pick an option (or type your own answer) for every question'}
              onClick={() => void decide('allow', { answers })}
            >
              <Send aria-hidden /> {busy === 'allow' ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 bg-card text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={!!busy || expired}
              onClick={() => void decide('deny')}
            >
              <X aria-hidden /> {busy === 'deny' ? 'Denying…' : 'Deny'}
            </Button>
            <Button className="h-11" disabled={!!busy || expired} onClick={() => void decide('allow')}>
              <Check aria-hidden /> {busy === 'allow' && !forSession ? 'Allowing…' : 'Allow'}
            </Button>
          </div>
        )}
        {/* As in the app: allow it, and Claude Code stops asking for this in the chat. */}
        {!sent && !answering && approval.remember && (
          <button
            type="button"
            data-testid="allow-session"
            aria-label={`Allow for this session: ${approval.remember}`}
            disabled={!!busy || expired}
            onClick={() => void decide('allow', { remember: true })}
            className="mt-2 flex w-full flex-col items-start gap-0.5 rounded-xl border border-success/45 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-success/8 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCheck className="size-4" strokeWidth={2.4} aria-hidden />
              {busy === 'allow' && forSession ? 'Allowing for this session…' : 'Allow for this session'}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              Won’t ask again for: {approval.remember}
            </span>
          </button>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
