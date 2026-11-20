'use client';

import { CommandListResponse, CommandResponse, type AgentSessionDto } from '@pocket-agent/protocol';
import { ArrowUp, CircleStop, Hand, Lock, Square } from 'lucide-react';
import { capabilityRows } from '@/components/agents/capabilities';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { commandError } from '@/lib/commands';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

export function canInstruct(s: AgentSessionDto): boolean {
  return !s.endedAt && (s.capabilities.instructAnytime || s.capabilities.instructBetweenTurns);
}

const isBusy = (s: AgentSessionDto) => s.status === 'Running' || s.status === 'WaitingForPermission';

/** When the instruction will actually reach Claude — stated honestly per session type. */
function deliveryHint(s: AgentSessionDto): string {
  if (s.capabilities.instructAnytime) {
    if (isBusy(s)) {
      return s.capabilities.interrupt
        ? 'Claude is busy: this runs as soon as the current task finishes (or interrupt it).'
        : 'Claude is busy: this runs as soon as the current turn finishes.';
    }
    return s.mode === 'managed'
      ? 'Claude starts on this right away.'
      : 'Claude starts on this right away on your PC. Your editor won’t show it live; follow it here.';
  }
  return s.status === 'WaitingForInput'
    ? 'Claude is idle. A session you started yourself only receives this after the next turn you start on the PC finishes.'
    : 'Delivered when Claude finishes its current turn. Claude Code still asks on your PC for permissions.';
}

/** Commands sent to one session (newest first), refreshed live. */
export function useCommands(sessionId: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${sessionId}/commands`, CommandListResponse, { signal }).then((r) => r.commands),
    [sessionId],
  );
  const poll = usePoll(fetcher, 30_000);
  useLiveRefresh(
    () => void poll.refresh(),
    (e) => e.eventType === 'command.status.changed' && e.sessionId === sessionId,
  );
  return poll;
}

async function control(session: AgentSessionDto, action: 'interrupt' | 'stop'): Promise<string | null> {
  const { command } = await apiRequest(`/sessions/${session.id}/${action}`, CommandResponse, {
    method: 'POST',
    body: { idempotencyKey: crypto.randomUUID() },
  });
  return command.status === 'Failed' ? commandError(command) : null;
}

/** Renders `code` spans in a hint. */
function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Message box pinned to the bottom of a chat. Enter sends (Shift+Enter: new line; phones: the button). */
export function Composer({
  session,
  onSent,
  onInfo,
}: {
  session: AgentSessionDto;
  onSent: () => void;
  onInfo?: () => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: retrying after a network error can never send it twice.
  const key = useRef(crypto.randomUUID());
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a limit (then it scrolls).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // The box is always there, like any chat app; when this session can't take messages it is
  // disabled and says why (never pretends a message could be delivered).
  const locked = canInstruct(session)
    ? null
    : session.endedAt
      ? 'This session has ended.'
      : (capabilityRows(session).find((r) => r.label === 'Send instructions')?.detail ??
        'Messages can’t be sent to this session.');
  const showStop = !session.endedAt && isBusy(session);
  const canInterrupt = showStop && session.capabilities.interrupt;

  async function send() {
    const value = text.trim();
    if (!value || pending || locked) return;
    setPending(true);
    setError(null);
    try {
      const { command } = await apiRequest(`/sessions/${session.id}/instructions`, CommandResponse, {
        method: 'POST',
        body: { text: value, idempotencyKey: key.current },
      });
      key.current = crypto.randomUUID();
      setText('');
      if (command.status === 'Failed') setError(commandError(command));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
      box.current?.focus();
    }
  }

  async function interrupt() {
    setInterrupting(true);
    setError(null);
    try {
      setError(await control(session, 'interrupt'));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInterrupting(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (e.ctrlKey || e.metaKey || (!e.shiftKey && !touch)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex flex-col gap-2"
      data-testid="composer"
      data-locked={locked ? 'true' : undefined}
    >
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="send-error"
        >
          {error}
        </p>
      )}
      <div className="rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-primary/15">
        <label htmlFor="instruction" className="sr-only">
          Send an instruction
        </label>
        <textarea
          id="instruction"
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={20_000}
          disabled={!!locked}
          placeholder={locked ? 'Messaging is off for this session' : 'Message Claude…'}
          className="block disabled:cursor-not-allowed max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground sm:text-[14.5px]"
        />
        <div className="flex items-end gap-2 pt-1 pr-2 pb-2 pl-4">
          <p
            className="min-w-0 flex-1 pb-1 text-xs text-pretty text-muted-foreground"
            data-testid="delivery-hint"
          >
            {locked ? (
              <>
                <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                <Ticks text={locked} />
                {onInfo && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={onInfo}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Session info
                    </button>
                  </>
                )}
              </>
            ) : (
              deliveryHint(session)
            )}
          </p>
          {showStop && (
            <button
              type="button"
              onClick={() => void interrupt()}
              disabled={interrupting || !canInterrupt}
              aria-label="Interrupt"
              title={
                canInterrupt
                  ? 'Interrupt Claude'
                  : 'Stopping is only possible for sessions started from Pocket Agent'
              }
              className="grid size-9 shrink-0 place-items-center rounded-xl border text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          )}
          <button
            type="submit"
            disabled={pending || !text.trim() || !!locked}
            aria-label={pending ? 'Sending…' : 'Send'}
            title="Send (Enter)"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs outline-none transition-[opacity,transform] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40',
              pending && 'animate-pulse',
            )}
          >
            <ArrowUp className="size-4.5" strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      </div>
    </form>
  );
}

export function SessionControls({ session, onDone }: { session: AgentSessionDto; onDone: () => void }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<'interrupt' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session.capabilities.interrupt || session.endedAt) return null;

  async function run(action: 'interrupt' | 'stop') {
    setBusy(action);
    setError(null);
    try {
      setError(await control(session, action));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!isBusy(session) || !!busy}
          onClick={() => void run('interrupt')}
        >
          <Hand aria-hidden /> {busy === 'interrupt' ? 'Interrupting…' : 'Interrupt'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!!busy}
          onClick={() => setConfirmStop(true)}
        >
          <CircleStop aria-hidden /> End session
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Modal
        role="alertdialog"
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="End this session?"
        description="Claude stops immediately and the session closes. Queued instructions are not run."
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setConfirmStop(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy === 'stop'} onClick={() => void run('stop')}>
            {busy === 'stop' ? 'Ending…' : 'End session'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
