'use client';

import {
  CommandListResponse,
  CommandResponse,
  type AgentSessionDto,
  type CommandDto,
} from '@pocket-agent/protocol';
import { CircleStop, Hand, SendHorizontal } from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { commandError, commandTitle, isOpen, STATUS_LABEL, STATUS_TONE } from '@/lib/commands';
import { timeAgo } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

export function canInstruct(s: AgentSessionDto): boolean {
  return !s.endedAt && (s.capabilities.instructAnytime || s.capabilities.instructBetweenTurns);
}

/** When the instruction will actually reach Claude — stated honestly per session type. */
function deliveryHint(s: AgentSessionDto): string {
  if (s.capabilities.instructAnytime) {
    return s.status === 'Running' || s.status === 'WaitingForPermission'
      ? 'Claude is busy: this runs as soon as the current task finishes (or interrupt it).'
      : 'Claude starts on this right away.';
  }
  return s.status === 'WaitingForInput'
    ? 'Claude is idle. A session you started yourself only receives this after the next turn you start on the PC finishes.'
    : 'Delivered when Claude finishes its current turn. Claude Code still asks on your PC for permissions.';
}

function useCommands(sessionId: string) {
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

export function Composer({ session, onSent }: { session: AgentSessionDto; onSent: () => void }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: retrying after a network error can never send it twice.
  const key = useRef(crypto.randomUUID());

  if (!canInstruct(session)) return null;

  async function send() {
    const value = text.trim();
    if (!value || pending) return;
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
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
    >
      <label htmlFor="instruction" className="text-sm font-medium">
        Send an instruction
      </label>
      <textarea
        id="instruction"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        maxLength={20_000}
        placeholder="e.g. Run the tests and fix anything that fails"
        className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground" data-testid="delivery-hint">
          {deliveryHint(session)}
        </p>
        <Button type="submit" disabled={pending || !text.trim()} className="shrink-0">
          <SendHorizontal aria-hidden /> {pending ? 'Sending…' : 'Send'}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="send-error"
        >
          {error}
        </p>
      )}
    </form>
  );
}

export function SessionControls({ session, onDone }: { session: AgentSessionDto; onDone: () => void }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<'interrupt' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session.capabilities.interrupt || session.endedAt) return null;
  const running = session.status === 'Running' || session.status === 'WaitingForPermission';

  async function run(action: 'interrupt' | 'stop') {
    setBusy(action);
    setError(null);
    try {
      const { command } = await apiRequest(`/sessions/${session.id}/${action}`, CommandResponse, {
        method: 'POST',
        body: { idempotencyKey: crypto.randomUUID() },
      });
      if (command.status === 'Failed') setError(commandError(command));
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
          disabled={!running || !!busy}
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

function CommandRow({ c }: { c: CommandDto }) {
  const err = commandError(c);
  return (
    <li className="flex flex-col gap-1 py-2.5" data-testid="command-row" data-status={c.status}>
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 min-w-0 text-sm break-words">{commandTitle(c)}</p>
        <Badge variant={STATUS_TONE[c.status]} className="shrink-0">
          {isOpen(c.status) && (
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
          )}
          {STATUS_LABEL[c.status]}
        </Badge>
      </div>
      <p className={cn('text-xs', err ? 'text-destructive' : 'text-muted-foreground')}>
        {err ?? `Sent ${timeAgo(c.createdAt)}`}
      </p>
    </li>
  );
}

export function RemoteControl({ session, onChange }: { session: AgentSessionDto; onChange: () => void }) {
  const { state, refresh } = useCommands(session.id);
  const commands = state.data ?? [];
  const showComposer = canInstruct(session);
  if (!showComposer && !commands.length && !(session.capabilities.interrupt && !session.endedAt)) return null;
  const changed = () => {
    void refresh();
    onChange();
  };
  return (
    <Card className="gap-4" data-testid="remote-control">
      <CardTitle>Control</CardTitle>
      <Composer session={session} onSent={changed} />
      <SessionControls session={session} onDone={changed} />
      {commands.length > 0 && (
        <div>
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sent from Pocket Agent
          </h3>
          <ul className="divide-y" aria-label="Sent commands">
            {commands.slice(0, 10).map((c) => (
              <CommandRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
