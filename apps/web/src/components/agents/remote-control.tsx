'use client';

import {
  CommandListResponse,
  CommandResponse,
  ATTACHMENT_MAX_PER_MESSAGE,
  DeviceListResponse,
  type AgentSessionDto,
  type ModelOption,
} from '@pocket-agent/protocol';
import { ArrowUp, Check, ChevronDown, CircleStop, Hand, Lock, Plus, Power, Square } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { DraftFiles, type DraftFile } from '@/components/agents/attachments';
import { capabilityRows } from '@/components/agents/capabilities';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { ATTACHMENT_ACCEPT, attachmentProblem, discardAttachment, uploadAttachment } from '@/lib/attachments';
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
        : 'Claude is busy: it reads this at its next step, or when the current turn finishes.';
    }
    return s.mode === 'managed'
      ? 'Claude starts on this right away.'
      : 'Claude starts on this right away on your PC. Your editor won’t show it live; follow it here.';
  }
  return s.status === 'WaitingForInput'
    ? 'Claude is idle, so this waits for the next turn you start on the PC. To run it at once, turn on wake on the PC: pocket-agent instructions wake enable'
    : 'Claude reads this at its next step while it works, or when the turn ends. Claude Code still asks on your PC for permissions.';
}

/** Commands sent to one session (newest first), refreshed live. */
export function useCommands(sessionId: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/sessions/${sessionId}/commands`, CommandListResponse, { signal }).then((r) => r.commands),
    [sessionId],
  );
  const poll = usePoll(['commands', sessionId], fetcher, 30_000);
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

/** Models the session's PC offers (Claude Code's own list), from the cached device list. */
function useDeviceModels(deviceId: string): ModelOption[] {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state } = usePoll(['devices'], fetcher, 60_000);
  return state.data?.find((d) => d.id === deviceId)?.models ?? [];
}

/** The model picked for this chat, remembered on this device ('' = leave the session's model). */
function useChosenModel(sessionId: string, models: ModelOption[]) {
  const storageKey = `pocket-agent:model:${sessionId}`;
  const [model, setModel] = useState('');
  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(storageKey) ?? '';
    } catch {
      /* private mode: just not remembered */
    }
    const t = setTimeout(() => setModel(saved), 0);
    return () => clearTimeout(t);
  }, [storageKey]);
  const choose = (id: string) => {
    setModel(id);
    try {
      if (id) localStorage.setItem(storageKey, id);
      else localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };
  // A model the PC no longer offers is never sent.
  const valid = models.some((m) => m.id === model) ? model : '';
  return [valid, choose] as const;
}

/** Why the model can't be chosen right now, or null if it can. */
function modelLock(s: AgentSessionDto): string | null {
  if (s.mode === 'managed') return null;
  if (!s.capabilities.instructAnytime)
    return 'This session runs in your editor with the model chosen there. Turn on wake on the PC to run turns from here with another model.';
  if (isBusy(s)) return 'Claude is mid-turn in your editor; that turn keeps the editor’s model.';
  return null;
}

function ModelPicker({
  models,
  value,
  onChange,
  locked,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  locked: string | null;
}) {
  const current = models.find((m) => m.id === value);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        disabled={!!locked}
        title={locked ?? 'Model for your next message'}
        aria-label={`Model: ${current?.name ?? 'session’s model'}`}
        data-testid="model-picker"
        className="flex h-8 max-w-[11rem] min-w-0 items-center gap-1 rounded-lg border bg-muted/60 px-2.5 text-[12.5px] font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className="truncate">{locked ? 'Editor’s model' : (current?.name ?? 'Model')}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
            Select a model
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {[{ id: '', name: 'Keep the session’s model', description: 'Don’t change it' }, ...models].map(
              (m) => (
                <DropdownMenu.RadioItem
                  key={m.id || 'keep'}
                  value={m.id}
                  className="flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-accent data-[state=checked]:bg-accent/70"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    {m.description && (
                      <span className="block truncate text-xs text-muted-foreground">{m.description}</span>
                    )}
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4 text-primary" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ),
            )}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
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
  const picker = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftFile[]>([]);
  const uploads = useRef(new Map<string, AbortController>());
  const uploading = drafts.some((d) => d.status === 'uploading');

  /** Removed before sending: stop the upload, and delete what was already stored. */
  function removeDraft(draftKey: string) {
    uploads.current.get(draftKey)?.abort();
    uploads.current.delete(draftKey);
    const ref = drafts.find((d) => d.key === draftKey)?.ref;
    if (ref) void discardAttachment(ref.id);
    setDrafts((d) => d.filter((x) => x.key !== draftKey));
  }
  const ready = drafts.filter((d) => d.status === 'ready' && d.ref);

  /** Picked or pasted files start uploading at once; each can be removed before sending. */
  function addFiles(list: Iterable<File>) {
    setError(null);
    const room = ATTACHMENT_MAX_PER_MESSAGE - drafts.length;
    const files = [...list];
    if (files.length > room) setError(`At most ${ATTACHMENT_MAX_PER_MESSAGE} files per message.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const draftKey = crypto.randomUUID();
      const problem = attachmentProblem(file);
      if (problem) {
        setDrafts((d) => [...d, { key: draftKey, file, status: 'error', error: problem }]);
        continue;
      }
      setDrafts((d) => [...d, { key: draftKey, file, status: 'uploading' }]);
      const abort = new AbortController();
      uploads.current.set(draftKey, abort);
      uploadAttachment(file, abort.signal)
        .then((ref) => {
          // Removed while the last step was in flight: don't keep the file.
          if (abort.signal.aborted) return void discardAttachment(ref.id);
          setDrafts((d) => d.map((x) => (x.key === draftKey ? { ...x, status: 'ready', ref } : x)));
        })
        .catch((err: Error) => {
          if (abort.signal.aborted) return;
          setDrafts((d) =>
            d.map((x) => (x.key === draftKey ? { ...x, status: 'error', error: err.message } : x)),
          );
        })
        .finally(() => uploads.current.delete(draftKey));
    }
  }

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
  const models = useDeviceModels(session.deviceId);
  const [model, setModel] = useChosenModel(session.id, models);
  const modelLocked = modelLock(session);

  // Something typed or attached: the button sends. Nothing, and Claude is working: it stops Claude.
  const hasContent = !!text.trim() || ready.length > 0;
  const stopMode = !hasContent && showStop;

  async function send() {
    // A message can be just files: Claude is then told what they are called.
    const value =
      text.trim() || (ready.length ? `Attached: ${ready.map((d) => d.ref!.name).join(', ')}` : '');
    if (!value || pending || locked || uploading) return;
    setPending(true);
    setError(null);
    try {
      const { command } = await apiRequest(`/sessions/${session.id}/instructions`, CommandResponse, {
        method: 'POST',
        body: {
          text: value,
          idempotencyKey: key.current,
          ...(model && !modelLocked ? { model } : {}),
          ...(ready.length ? { attachmentIds: ready.map((d) => d.ref!.id) } : {}),
        },
      });
      key.current = crypto.randomUUID();
      setText('');
      setDrafts([]);
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
        <DraftFiles drafts={drafts} onRemove={removeDraft} />
        <label htmlFor="instruction" className="sr-only">
          Send an instruction
        </label>
        <textarea
          id="instruction"
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={(e) => {
            // A screenshot pasted from the clipboard is attached like a picked file.
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
          }}
          rows={1}
          maxLength={20_000}
          disabled={!!locked}
          placeholder={locked ? 'Messaging is off for this session' : 'Message Claude…'}
          className="block disabled:cursor-not-allowed max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground sm:text-[14.5px]"
        />
        <p className="px-4 pb-1 text-xs text-pretty text-muted-foreground" data-testid="delivery-hint">
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
        {/* Like the editor's input: what the message runs with on the left, stop and send on the right. */}
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          {!locked && (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-label="Attach photos or PDFs"
                data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = ''; // the same file can be picked again
                }}
              />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={drafts.length >= ATTACHMENT_MAX_PER_MESSAGE}
                aria-label="Attach a photo or PDF"
                title="Attach a photo or PDF (kept 30 days)"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
              >
                <Plus className="size-[18px]" aria-hidden />
              </button>
            </>
          )}
          {!locked && models.length > 0 && (
            <ModelPicker models={models} value={model} onChange={setModel} locked={modelLocked} />
          )}
          <span className="flex-1" />
          {/* One button: Send when there is something to send; Stop while Claude works; else nothing to do. */}
          <button
            type={stopMode ? 'button' : 'submit'}
            onClick={stopMode ? () => void interrupt() : undefined}
            disabled={
              stopMode ? interrupting || !canInterrupt : pending || uploading || !hasContent || !!locked
            }
            aria-label={stopMode ? 'Interrupt' : pending ? 'Sending…' : 'Send'}
            title={
              stopMode
                ? canInterrupt
                  ? session.mode === 'managed'
                    ? 'Stop Claude'
                    : 'Stop Claude (it stops at its next step)'
                  : 'Stopping is turned off on this PC (pocket-agent instructions enable)'
                : 'Send (Enter)'
            }
            data-mode={stopMode ? 'stop' : 'send'}
            className={cn(
              'relative grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs outline-none transition-[opacity,transform,background-color] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40',
              (pending || interrupting) && 'animate-pulse',
            )}
          >
            {/* The two icons share the spot: one turns into the other. */}
            <ArrowUp
              className={cn(
                'absolute size-4.5 transition-[opacity,transform] duration-200 ease-(--ease-out)',
                stopMode ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
              )}
              strokeWidth={2.5}
              aria-hidden
            />
            <Square
              className={cn(
                'absolute size-3.5 fill-current transition-[opacity,transform] duration-200 ease-(--ease-out)',
                stopMode ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
              )}
              aria-hidden
            />
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
        description={END_TEXT(session)}
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

const END_TEXT = (s: AgentSessionDto) =>
  s.mode === 'managed'
    ? 'Claude stops immediately and the session closes. Queued instructions are not run.'
    : 'This closes the session’s Claude Code process on your PC, whatever it is doing. The conversation is kept: you can resume it in your editor.';

/** Header button: ends the session (after asking). Only shown when this session can be ended. */
export function EndSessionButton({ session, onDone }: { session: AgentSessionDto; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session.capabilities.interrupt || session.endedAt) return null;

  async function end() {
    setBusy(true);
    setError(null);
    try {
      const failed = await control(session, 'stop');
      setError(failed);
      if (!failed) setOpen(false);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="End session"
        title="End session"
        data-testid="end-session"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Power className="size-[18px]" aria-hidden />
      </button>
      <Modal
        role="alertdialog"
        open={open}
        onOpenChange={setOpen}
        title="End this session?"
        description={END_TEXT(session)}
      >
        {error && (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void end()}>
            {busy ? 'Ending…' : 'End session'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
