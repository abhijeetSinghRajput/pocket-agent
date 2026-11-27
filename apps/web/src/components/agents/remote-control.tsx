'use client';

import {
  agentName,
  canConfigureLive,
  canInstruct,
  capabilityRows,
  deliveryHint,
  EFFORTS,
  END_TEXT,
  isBusy,
  MODES,
  modesFor,
  modelLock,
  resumeBlocker,
} from '@pocket-agent/core';
import {
  CommandListResponse,
  CommandResponse,
  attachmentLimit,
  DeviceListResponse,
  RESUME_FILES_AGENT_VERSION,
  CODEX_MODES_AGENT_VERSION,
  versionBelow,
  type AgentSessionDto,
  type DeviceDto,
  type ModelOption,
} from '@pocket-agent/protocol';
import { ArrowUp, Check, ChevronDown, CircleStop, Hand, Lock, Plus, Power, Square, Zap } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { DraftFiles } from '@/components/agents/attachments';
import { DropOverlay, useDraftFiles, useFileDrop } from '@/components/agents/draft-files';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { commandError } from '@/lib/commands';
import { useLiveRefresh } from '@/lib/live';
import { usePoll } from '@/lib/use-poll';
import { cn } from '@/lib/utils';

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
function useDevice(deviceId: string): DeviceDto | undefined {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/devices', DeviceListResponse, { signal }).then((r) => r.devices),
    [],
  );
  const { state } = usePoll(['devices'], fetcher, 60_000);
  return state.data?.find((d) => d.id === deviceId);
}

/** A choice made for this chat, remembered on this device ('' = leave the session as it is). */
function useStoredChoice(key: string) {
  const [value, setValue] = useState('');
  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(key) ?? '';
    } catch {
      /* private mode: just not remembered */
    }
    const t = setTimeout(() => setValue(saved), 0);
    return () => clearTimeout(t);
  }, [key]);
  const choose = (v: string) => {
    setValue(v);
    try {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return [value, choose] as const;
}

/** The model picked for this chat. A model the PC no longer offers is never sent. */
function useChosenModel(sessionId: string, models: ModelOption[]) {
  const [model, choose] = useStoredChoice(`pocket-agent:model:${sessionId}`);
  return [models.some((m) => m.id === model) ? model : '', choose] as const;
}

const chip =
  'flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';
const menu =
  'z-50 max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95';
const item =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-accent data-[state=checked]:bg-accent/70';

function Choice({ name, description }: { name: string; description?: string }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      <DropdownMenu.ItemIndicator>
        <Check className="size-4 text-primary" aria-hidden />
      </DropdownMenu.ItemIndicator>
    </>
  );
}

/** Like the editor's mode menu: how Claude asks before acting, for turns run from here. */
export function ModePicker({
  value,
  onChange,
  locked,
  modes = MODES,
}: {
  value: string;
  onChange: (v: string) => void;
  locked: string | null;
  modes?: readonly (typeof MODES)[number][];
}) {
  const current = modes.find((m) => m.id === value);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        disabled={!!locked}
        title={
          locked ??
          'Sent with your next message. If Claude is busy in your editor then, it switches with the next request you allow here'
        }
        aria-label={`Mode: ${current?.name ?? 'session’s mode'}`}
        data-testid="mode-picker"
        className={chip}
      >
        <Zap className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{current?.name ?? 'Mode'}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={8} collisionPadding={8} className={menu}>
          <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
            Mode
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            <DropdownMenu.RadioItem value="" className={item}>
              <Choice name="Keep the session’s mode" />
            </DropdownMenu.RadioItem>
            {modes.map((m) => (
              <DropdownMenu.RadioItem key={m.id} value={m.id} className={item}>
                <Choice name={m.name} description={m.description} />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
  effort,
  onEffort,
  locked,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  effort: string;
  onEffort: (v: string) => void;
  locked: string | null;
}) {
  const current = models.find((m) => m.id === value);
  const level = EFFORTS.find((e) => e.id === effort);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        disabled={!!locked}
        title={locked ?? 'Model and effort for your next message'}
        aria-label={`Model: ${current?.name ?? 'session’s model'}`}
        data-testid="model-picker"
        className={chip}
      >
        <span className="truncate">
          {current?.name ?? 'Model'}
          {level && <span className="font-normal"> · {level.name}</span>}
        </span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={8} collisionPadding={8} className={menu}>
          <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
            Select a model
          </DropdownMenu.Label>
          {models.length === 0 && (
            <p className="px-2.5 pb-2 text-xs text-muted-foreground">
              Update Pocket Agent on your PC to see its models.
            </p>
          )}
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            <DropdownMenu.RadioItem value="" className={item}>
              <Choice name="Keep the session’s model" />
            </DropdownMenu.RadioItem>
            {models.map((m) => (
              <DropdownMenu.RadioItem key={m.id} value={m.id} className={item}>
                <Choice name={m.name} {...(m.description ? { description: m.description } : {})} />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
            Effort
          </DropdownMenu.Label>
          {/* Effort as one row of steps, like the editor's slider. */}
          <div role="radiogroup" aria-label="Effort" className="flex gap-1 px-1.5 pb-1.5">
            {[{ id: '', name: 'Auto' }, ...EFFORTS].map((e) => (
              <button
                key={e.id || 'keep'}
                type="button"
                role="radio"
                aria-checked={effort === e.id}
                title={e.id ? e.name : 'Keep the session’s effort'}
                onClick={() => onEffort(e.id)}
                className={cn(
                  'h-8 min-w-0 flex-1 rounded-md text-[11.5px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  effort === e.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
                )}
              >
                {e.id === 'xhigh' ? 'XHigh' : e.name}
              </button>
            ))}
          </div>
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
  // The unsent message is kept on this device: it survives a refresh or leaving the chat.
  const [text, setText] = useStoredChoice(`pocket-agent:draft:${session.id}`);
  const [pending, setPending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: retrying after a network error can never send it twice.
  const key = useRef(crypto.randomUUID());
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Grow with the text, up to a limit (then it scrolls).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // The box is always there, like any chat app; when this session can't take messages it is
  // disabled and says why (never pretends a message could be delivered).
  const device = useDevice(session.deviceId);
  const maxFiles = attachmentLimit(device?.agentVersion);
  // Picked or pasted files start uploading at once; each can be removed before sending.
  const files = useDraftFiles(maxFiles, setError, { keepUploaded: true });
  const { drafts, ready, uploading } = files;
  // Ended: sending continues the same conversation on the PC, when that's possible.
  const resuming = !!session.endedAt && resumeBlocker(session, device) === null;
  // Files go with the message that continues an ended session when the PC takes them (0.1.6+).
  const filesOnResume = !versionBelow(device?.agentVersion ?? '0', RESUME_FILES_AGENT_VERSION);
  const locked =
    canInstruct(session) || resuming
      ? null
      : session.endedAt
        ? (resumeBlocker(session, device) ?? 'This session has ended.')
        : (capabilityRows(session).find((r) => r.label === 'Send instructions')?.detail ??
          'Messages can’t be sent to this session.');
  const showStop = !session.endedAt && isBusy(session);
  const canInterrupt = showStop && session.capabilities.interrupt;
  // Codex keeps its approval settings for now (no Mode), and has its own models.
  const isCodex = session.provider === 'codex';
  const isOther = session.provider !== 'claude-code';
  // Codex takes a mode on PCs from 2.7.0; Antigravity always.
  const modesOk = !isCodex || !versionBelow(device?.agentVersion ?? '0', CODEX_MODES_AGENT_VERSION);
  const models =
    (isOther ? device?.agents.find((a) => a.provider === session.provider)?.models : device?.models) ?? [];
  const [model, setModel] = useChosenModel(session.id, models);
  const [mode, setMode] = useStoredChoice(`pocket-agent:mode:${session.id}`);
  const [effort, setEffort] = useStoredChoice(`pocket-agent:effort:${session.id}`);
  const modelLocked = resuming ? null : modelLock(session);

  // A session Pocket Agent runs switches mode or model at once, mid-task too (the chat shows
  // "You switched to …"); any other takes the choice with the next message sent from here.
  const live = canConfigureLive(session, device) && !isOther;
  async function applyNow(change: { permissionMode: string } | { model: string }) {
    if (!live) return;
    setError(null);
    try {
      const { command } = await apiRequest(`/sessions/${session.id}/configure`, CommandResponse, {
        method: 'POST',
        body: { idempotencyKey: crypto.randomUUID(), ...change },
      });
      if (command.status === 'Failed') setError(commandError(command));
      onSent();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const chooseMode = (value: string) => {
    setMode(value);
    if (value) void applyNow({ permissionMode: value });
  };
  const chooseModel = (value: string) => {
    setModel(value);
    if (value) void applyNow({ model: value });
  };

  // Something typed or attached: the button sends. Nothing, and Claude is working: it stops Claude.
  // An ended chat says so in its placeholder ("Continue this session…"): no line under the box.
  const hint = locked || resuming ? '' : deliveryHint(session);
  const hasContent = !!text.trim() || ready.length > 0;
  const stopMode = !hasContent && showStop;

  // Files dragged anywhere over the chat are attached here (native drag and drop).
  const dragging = useFileDrop(!locked && (!resuming || filesOnResume), files.add);

  async function send() {
    // A message can be just files: Claude is then told what they are called.
    const value =
      text.trim() || (ready.length ? `Attached: ${ready.map((d) => d.ref!.name).join(', ')}` : '');
    if (!value || pending || locked || uploading) return;
    setPending(true);
    setError(null);
    try {
      const choices = {
        ...(model && !modelLocked ? { model } : {}),
        ...(mode && !modelLocked && modesOk ? { permissionMode: mode } : {}),
        ...(effort && !modelLocked ? { effort } : {}),
      };
      const { command } = resuming
        ? // Ended: the PC reopens this conversation and runs the message in it.
          await apiRequest(`/sessions/${session.id}/resume`, CommandResponse, {
            method: 'POST',
            body: {
              text: value,
              idempotencyKey: key.current,
              ...choices,
              ...(ready.length ? { attachmentIds: ready.map((d) => d.ref!.id) } : {}),
            },
          })
        : await apiRequest(`/sessions/${session.id}/instructions`, CommandResponse, {
            method: 'POST',
            body: {
              text: value,
              idempotencyKey: key.current,
              ...choices,
              ...(ready.length ? { attachmentIds: ready.map((d) => d.ref!.id) } : {}),
            },
          });
      key.current = crypto.randomUUID();
      setText('');
      files.clear();
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
      {dragging && <DropOverlay />}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="send-error"
        >
          {error}
        </p>
      )}
      <div className="relative rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-primary/15">
        {/*
          The field's own label covers the whole box, underneath its controls: a click anywhere that
          isn't a button lands on the label, and the browser focuses the field. No script involved.
        */}
        <label
          htmlFor="instruction"
          className={cn('absolute inset-0 rounded-2xl', locked ? 'cursor-not-allowed' : 'cursor-text')}
        >
          <span className="sr-only">Send an instruction</span>
        </label>
        <div className="pointer-events-none relative *:pointer-events-auto">
          <DraftFiles drafts={drafts} onRemove={files.remove} />
          <textarea
            id="instruction"
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={(e) => {
              // A screenshot pasted from the clipboard is attached like a picked file.
              const pasted = [...e.clipboardData.files];
              if (!pasted.length || (resuming && !filesOnResume)) return;
              e.preventDefault();
              files.add(pasted);
            }}
            rows={1}
            maxLength={20_000}
            disabled={!!locked}
            placeholder={
              locked
                ? 'Messaging is off for this session'
                : resuming
                  ? 'Continue this session…'
                  : `Message ${agentName(session.provider)}…`
            }
            className="block disabled:cursor-not-allowed max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground sm:text-[14.5px]"
          />
          {(locked || hint) && (
            <p
              className="pointer-events-none! px-4 pb-1 text-xs text-pretty text-muted-foreground *:pointer-events-auto"
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
                hint
              )}
            </p>
          )}
          {/* Like the editor's input: what the message runs with on the left, stop and send on the right. */}
          <div className="pointer-events-none! flex items-center gap-2 px-2 pt-1 pb-2 *:pointer-events-auto">
            {/* Files go with a message that continues an ended session only if the PC takes them. */}
            {!locked && (!resuming || filesOnResume) && (
              <>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Attach files"
                  data-testid="file-input"
                  onChange={(e) => {
                    if (e.target.files) files.add(e.target.files);
                    e.target.value = ''; // the same file can be picked again
                  }}
                />
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  disabled={drafts.length >= maxFiles}
                  aria-label="Attach files"
                  title="Attach files (kept 30 days)"
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
                >
                  <Plus className="size-[18px]" aria-hidden />
                </button>
              </>
            )}
            {!locked && (
              <>
                {modesOk && (
                  <ModePicker
                    value={mode}
                    onChange={chooseMode}
                    locked={modelLocked}
                    modes={modesFor(session.provider)}
                  />
                )}
                <ModelPicker
                  models={models}
                  value={model}
                  onChange={chooseModel}
                  effort={effort}
                  onEffort={setEffort}
                  locked={modelLocked}
                />
              </>
            )}
            <span className="pointer-events-none! flex-1" />
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
                      ? `Stop ${agentName(session.provider)}`
                      : `Stop ${agentName(session.provider)} (it stops at its next step)`
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
