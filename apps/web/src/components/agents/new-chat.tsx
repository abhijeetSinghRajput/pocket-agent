'use client';

import {
  agentName,
  agentProduct,
  buildChat,
  commandError,
  modesFor,
  NEW_CHAT_MODE,
  newChatModel,
  signInCommand,
  waitForSession,
} from '@pocket-agent/core';
import {
  attachmentLimit,
  CODEX_MODES_AGENT_VERSION,
  CommandResponse,
  providerAgentVersion,
  RESUME_FILES_AGENT_VERSION,
  versionBelow,
  type CommandDto,
  type ProviderId,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import { ArrowLeft, ArrowUp, Folder, FolderOpen, Monitor, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AgentPicker } from '@/components/agents/agent-picker';
import { DraftFiles } from '@/components/agents/attachments';
import { AgentName, ChatMessages } from '@/components/agents/chat-messages';
import { DropOverlay, useDraftFiles, useFileDrop } from '@/components/agents/draft-files';
import { NewSessionDialog, useDevices } from '@/components/agents/new-session-dialog';
import { ModelPicker, ModePicker } from '@/components/agents/remote-control';
import { Button } from '@/components/ui/button';
import { playSound } from '@/components/ui/sound';
import { apiRequest } from '@/lib/api';
import { routes } from '@/lib/nav';
import { cn } from '@/lib/utils';

const fetchCommand = (id: string) => apiRequest(`/commands/${id}`, CommandResponse).then((r) => r.command);

const header =
  'z-10 flex shrink-0 items-center gap-1 border-b bg-card/90 px-1.5 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:gap-2 sm:px-3';
const backButton =
  'grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 lg:hidden';

/** `/chat/new` opened without a folder (a bookmark, a reload of an old link): pick one first. */
function NoFolder() {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex h-[var(--chat-height,100dvh)] flex-col bg-background" aria-label="New chat">
      <div className="content-in flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <FolderOpen className="size-10 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">New chat</h1>
          <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
            Pick a folder on your PC. Claude Code starts there.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Pick a folder</Button>
      </div>
      <NewSessionDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

/**
 * A chat that has not started yet, in a folder picked from New chat. Sending the first message
 * starts the chosen agent (Claude Code, or another the PC has) there on the PC; the chat then
 * opens as the real session. The same screen as the app's.
 */
export function NewChat({ deviceId, path, name }: { deviceId?: string; path?: string; name?: string }) {
  if (!deviceId || !path) return <NoFolder />;
  return (
    <NewChatIn
      key={`${deviceId}|${path}`}
      deviceId={deviceId}
      path={path}
      name={name || (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path)}
    />
  );
}

function NewChatIn({ deviceId, path, name }: { deviceId: string; path: string; name: string }) {
  const router = useRouter();
  const devices = useDevices().state;
  const device = devices.data?.find((d) => d.id === deviceId);
  const [text, setText] = useState('');
  // null until picked: the new-chat default (Opus) applies; '' is the PC's own default.
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string>(NEW_CHAT_MODE);
  const [effort, setEffort] = useState('');
  // Which agent: Claude Code, or another the PC reports (Codex, Antigravity…) that its PC agent
  // can start.
  const [provider, setProvider] = useState<ProviderId>('claude-code');
  const others = (device?.agents ?? []).filter(
    (a) => !versionBelow(device?.agentVersion ?? '0', providerAgentVersion(a.provider)),
  );
  const other = others.find((a) => a.provider === provider);
  const agent: ProviderId = other ? other.provider : 'claude-code';
  const isCodex = agent === 'codex';
  // Codex takes a mode on PCs from 2.7.0; the others always (their PC agent is newer).
  const modesOk = !isCodex || !versionBelow(device?.agentVersion ?? '0', CODEX_MODES_AGENT_VERSION);
  const signIn = signInCommand(agent);
  // The first message once sent: shown as sent while the PC starts the agent.
  const [command, setCommand] = useState<CommandDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const models = (other ? other.models : device?.models) ?? [];
  // A model the PC no longer offers is never sent. Another agent starts on its own default.
  const chosenModel =
    model !== null && (model === '' || models.some((m) => m.id === model))
      ? model
      : other
        ? ''
        : newChatModel(models);
  const starting = command !== null;
  // Until the PCs have loaded nothing is said about this one (it is not "no longer paired" yet).
  const loading = devices.status === 'loading';
  const locked = loading
    ? null
    : !device
      ? 'This PC is no longer paired.'
      : device.status !== 'Online'
        ? 'Your PC is offline. Start Pocket Agent on it to begin.'
        : other && !other.signedIn
          ? `Sign in to ${agentProduct(agent)} on your PC first (run \`${signIn}\` there).`
          : null;
  const items = useMemo(() => (command ? buildChat([], [command]) : []), [command]);

  // Photos and files go with the first message (PC agents from 0.1.6 take them).
  const files = useDraftFiles(attachmentLimit(device?.agentVersion), setError);
  const canAttach =
    !loading &&
    !locked &&
    !starting &&
    !versionBelow(device?.agentVersion ?? '0', RESUME_FILES_AGENT_VERSION);
  const dragging = useFileDrop(canAttach, files.add);
  const hasContent = !!text.trim() || files.ready.length > 0;

  // Grow with the text, up to a limit (then it scrolls).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function start() {
    // A first message can be just files: the agent is then told what they are called.
    const value =
      text.trim() ||
      (files.ready.length ? `Attached: ${files.ready.map((d) => d.ref!.name).join(', ')}` : '');
    if (!value || starting || loading || locked || files.uploading) return;
    const typed = text;
    setError(null);
    try {
      let { command: sent } = await apiRequest(`/devices/${deviceId}/sessions`, CommandResponse, {
        method: 'POST',
        body: {
          ...(other ? { provider: agent } : {}),
          projectPath: path,
          text: value,
          idempotencyKey: key.current,
          ...(chosenModel ? { model: chosenModel } : {}),
          ...(mode && modesOk ? { permissionMode: mode as TurnMode } : {}),
          ...(effort ? { effort: effort as TurnEffort } : {}),
          ...(files.ready.length ? { attachmentIds: files.ids } : {}),
        },
      });
      setCommand(sent);
      setText('');
      // The files now belong to the message (shown in it while the PC starts the agent).
      files.clear();
      sent = await waitForSession(sent, fetchCommand, () => alive.current);
      if (!alive.current) return;
      if (sent.sessionId) {
        playSound('success');
        router.replace(routes.chat(sent.sessionId));
        return;
      }
      playSound('error');
      setError(commandError(sent) ?? 'Your PC did not start the session in time.');
      setText(typed);
      setCommand(null);
      key.current = crypto.randomUUID();
    } catch (err) {
      if (!alive.current) return;
      playSound('error');
      setError((err as Error).message);
      setText(typed);
      setCommand(null);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (e.ctrlKey || e.metaKey || (!e.shiftKey && !touch)) {
      e.preventDefault();
      void start();
    }
  };

  const status = starting ? 'starting…' : 'new chat';
  const agents: ProviderId[] = ['claude-code', ...others.map((a) => a.provider)];
  const title = `What should ${agentName(agent)} do?`;

  return (
    <section
      className="flex h-[var(--chat-height,100dvh)] flex-col overflow-hidden bg-background"
      aria-label={`New chat in ${name}`}
    >
      {dragging && <DropOverlay />}
      <header data-testid="chat-header" className={header}>
        <button
          type="button"
          aria-label="Back"
          disabled={starting}
          onClick={() => (window.history.length > 1 ? router.back() : router.replace(routes.chats))}
          className={backButton}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="flex h-16 min-w-0 flex-1 flex-col justify-center pl-1 lg:pl-2">
          <h1 className="truncate text-[15px] leading-tight font-semibold">{name}</h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <span className={cn('truncate', starting ? 'font-medium text-primary' : 'text-muted-foreground')}>
              <span key={status} className="roll-in">
                {status}
              </span>
            </span>
            {device && (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="truncate text-muted-foreground">{device.name}</span>
              </>
            )}
          </p>
        </div>
      </header>

      {starting ? (
        <AgentName.Provider value={agentName(agent)}>
          <ChatMessages items={items} typing="starting" />
        </AgentName.Provider>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
            {others.length > 0 && (
              <div className="px-3 pt-3 sm:px-6 sm:pt-5">
                <AgentPicker
                  agents={agents}
                  value={agent}
                  onChange={(next) => {
                    setProvider(next);
                    // Each agent has its own models.
                    setModel(null);
                    setEffort('');
                  }}
                />
              </div>
            )}
            <div
              className="rise-in flex flex-1 flex-col justify-center gap-2.5 px-5 py-6 sm:px-8"
              style={{ animationDelay: `${Math.min(agents.length, 8) * 50}ms` }}
            >
              <h2 className="overflow-hidden text-2xl font-semibold tracking-tight">
                <span key={title} className="roll-in block">
                  {title}
                </span>
              </h2>
              <div className="mt-0.5 flex flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {/* A long path keeps its end (the folder's own name) and loses its start. */}
                  <span
                    dir="rtl"
                    className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                    aria-label={`Folder ${path}`}
                    title={path}
                  >
                    <bdi dir="ltr">{path}</bdi>
                  </span>
                </div>
                {device && (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs">{device.name}</span>
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm text-pretty text-muted-foreground">
                {agentProduct(agent)} starts when you send your first message.{' '}
                {agent === 'claude-code'
                  ? 'Anything that needs permission asks you here.'
                  : agent !== 'codex'
                    ? device?.remoteApprovalEnabled
                      ? 'It keeps its own permission settings; anything it asks before doing comes to you here.'
                      : 'It keeps its own permission settings; anything it asks before doing is declined, because remote approval is off on this PC.'
                    : device?.remoteApprovalEnabled
                      ? 'It works in its sandbox: it changes files in this folder and asks you here for anything more.'
                      : 'It works in its sandbox: it changes files in this folder. Anything more is declined, because remote approval is off on this PC.'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative shrink-0 bg-background px-3 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-10 before:bg-linear-to-t before:from-background before:to-transparent sm:px-6">
        <form
          className="mx-auto flex max-w-3xl flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          {error && (
            <p
              role="alert"
              className="content-in rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="send-error"
            >
              {error}
            </p>
          )}
          <div
            data-testid="composer"
            data-locked={locked ? 'true' : undefined}
            className="relative rounded-2xl border-[1.5px] bg-card shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-primary/15"
          >
            {/* The field's label covers the whole box, under its controls: a click anywhere focuses it. */}
            <label
              htmlFor="ns-text"
              className={cn(
                'absolute inset-0 rounded-2xl',
                locked || starting ? 'cursor-not-allowed' : 'cursor-text',
              )}
            >
              <span className="sr-only">First message</span>
            </label>
            <div className="pointer-events-none relative *:pointer-events-auto">
              <DraftFiles drafts={files.drafts} onRemove={files.remove} />
              <textarea
                id="ns-text"
                ref={box}
                data-testid="ns-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                onPaste={(e) => {
                  // A screenshot pasted from the clipboard is attached like a picked file.
                  const pasted = [...e.clipboardData.files];
                  if (!pasted.length || !canAttach) return;
                  e.preventDefault();
                  files.add(pasted);
                }}
                rows={1}
                maxLength={20_000}
                disabled={!!locked || starting}
                autoFocus
                placeholder={locked ?? (starting ? 'Starting on your PC…' : `Message ${agentName(agent)}…`)}
                className="block max-h-[160px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed sm:text-[14.5px]"
              />
              <div className="pointer-events-none! flex items-center gap-1 px-2 pt-1 pb-2 *:pointer-events-auto">
                {canAttach && (
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
                      disabled={files.room <= 0}
                      aria-label="Attach files"
                      title="Attach files (kept 30 days)"
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
                    >
                      <Plus className="size-[18px]" aria-hidden />
                    </button>
                  </>
                )}
                {!locked && !loading && (
                  <>
                    {modesOk && (
                      <ModePicker value={mode} onChange={setMode} locked={null} modes={modesFor(agent)} />
                    )}
                    <ModelPicker
                      models={models}
                      value={chosenModel}
                      onChange={setModel}
                      effort={effort}
                      onEffort={setEffort}
                      locked={null}
                    />
                  </>
                )}
                <span className="pointer-events-none! flex-1" />
                <button
                  type="submit"
                  disabled={starting || loading || files.uploading || !hasContent || !!locked}
                  aria-label={starting ? 'Starting on your PC…' : 'Start session'}
                  title={starting ? 'Starting on your PC…' : 'Start session (Enter)'}
                  data-testid="start-session"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs outline-none transition-[opacity,transform,background-color] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40',
                    starting && 'animate-pulse',
                  )}
                >
                  <ArrowUp className="size-4.5" strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
