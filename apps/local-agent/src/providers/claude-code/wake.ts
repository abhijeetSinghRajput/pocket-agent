import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { filesDir, messageContent, type LocalFile } from '../../attachments.js';
import { APP_CONTEXT } from './app-context.js';
import { LIVE_SETTINGS_METADATA, type TurnEffort, type TurnMode } from '@pocket-agent/protocol';
import type { CommandAck } from './instructions.js';
import { approvalGate, reportSdkMessage, type ManagedApprovalOptions, type QueryFn } from './managed.js';

interface Item {
  commandId: string;
  text: string;
  expiresAt: number;
  /** Model, mode and effort for this turn (the editor's own settings are not changed). */
  model?: string;
  permissionMode?: TurnMode;
  effort?: TurnEffort;
  /** Files sent with the message. */
  files?: LocalFile[];
}

/** One woken Claude process for a session: kept for the next message, closed when idle long enough. */
interface Woken {
  cwd: string;
  /** Messages waiting for their turn (not started: they can be withdrawn). */
  inbox: Item[];
  /** The message Claude is working on. */
  current: Item | null;
  query: Query | null;
  abort: AbortController;
  /** The effort the process was started with (it can't change mid-process). */
  effort: TurnEffort | undefined;
  /** The mode and model in use (switched only when a message asks for others). */
  mode: TurnMode | undefined;
  model: string | undefined;
  /** No more messages: the input stream ends and the process exits. */
  closed: boolean;
  /** Stopped from Pocket Agent (as opposed to the session ending). */
  interrupted: boolean;
  /** Its end was handled (once). */
  finished: boolean;
  /** Wakes the input stream when a message arrives (or it should end). */
  next?: () => void;
  /** Closes the process after a while without messages. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** The current turn's reply and tool names (what the transcript and the catch-up need). */
  reply: string;
  toolNames: Map<string, string>;
}

/** One exchange that happened outside the PC's own Claude Code window. */
interface Missed {
  prompt: string;
  reply: string;
}

const MAX_MISSED = 5;
/** A woken process waits this long for the next message from the phone before it exits. */
export const WAKE_KEEP_MS = 5 * 60_000;

/**
 * Wakes an idle session the user started themselves (VS Code, terminal) when an instruction
 * arrives from Pocket Agent. Claude Code can't take a prompt into an idle interactive session, so
 * the Local Agent resumes the same session through the Claude Agent SDK (verified: same session
 * id, full history). Automatic whenever phone messages to these sessions are allowed
 * (`instructions enable`, asked at setup).
 *
 * The resumed process is kept: the next message from the phone runs in it at once, without
 * loading the conversation again. It exits after `WAKE_KEEP_MS` without a message, when the
 * session ends, when Pocket Agent stops, or as soon as the PC wants the session back.
 *
 * Caveat, handled here: the editor keeps its own copy of the conversation in memory, so it doesn't
 * see these turns. While one runs, a prompt typed on the PC is held back (`blockPrompt`); a woken
 * process that is only waiting gives way at once (`release`). The next prompt typed on the PC gets
 * a summary of what was done meanwhile (`catchUp`).
 */
export class IdleWake {
  private readonly woken = new Map<string, Woken>();
  private readonly missed = new Map<string, Missed[]>();
  /** Sessions already told that the user is on the app. */
  private readonly briefed = new Set<string>();
  /** Folder where files from the app are saved (readable by woken turns). */
  filesRoot: string | undefined;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly ack: CommandAck,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
    private readonly keepMs: number = WAKE_KEEP_MS,
  ) {}

  /** Called after each woken turn (the transcript reader skips what this turn already reported). */
  onTurnEnd: (sessionId: string) => void = () => undefined;

  /** A woken process is open for this session (working, or waiting for the next message). */
  isRunning = (sessionId: string): boolean => this.woken.has(sessionId);

  /** Runs the instruction now: in the session's woken process, or a new one. */
  run(sessionId: string, cwd: string, item: Item): void {
    const w = this.woken.get(sessionId);
    // A different effort needs a new process: the open one ends (once idle), the message waits for it.
    if (w && !w.closed && (item.effort ?? w.effort) === w.effort) {
      w.inbox.push(item);
      this.ack(item.commandId, 'Accepted');
      if (w.idleTimer) clearTimeout(w.idleTimer);
      w.next?.();
      return;
    }
    if (w) {
      this.ack(item.commandId, 'Accepted');
      w.inbox.push(item);
      // Its inbox moves to the new process once it has exited.
      this.closeWhenIdle(sessionId, w);
      return;
    }
    this.start(sessionId, cwd, [item]);
  }

  /** Message for a prompt typed on the PC while a wake turn is running, or undefined to let it through. */
  blockPrompt(sessionId: string): string | undefined {
    const w = this.woken.get(sessionId);
    if (!w) return undefined;
    // Only waiting for the next message from the phone: the PC gets the session back at once.
    if (!w.current && !w.inbox.length) {
      this.release(sessionId);
      return undefined;
    }
    return 'Claude is still working on a message sent from Pocket Agent in this session. Send your prompt again once it has finished (you can follow it in Pocket Agent).';
  }

  /** The PC takes the session back: a woken process that is only waiting exits now. */
  release(sessionId: string): void {
    const w = this.woken.get(sessionId);
    if (!w || w.current || w.inbox.length) return;
    this.close(w);
  }

  /** What happened through Pocket Agent since the PC last saw this session (given once). */
  catchUp(sessionId: string): string | undefined {
    const list = this.missed.get(sessionId);
    if (!list?.length) return undefined;
    this.missed.delete(sessionId);
    const parts = list.map(
      (m, i) =>
        `${list.length > 1 ? `${i + 1}. ` : ''}The user asked: ${m.prompt}\nYou replied: ${m.reply || '(no text reply)'}`,
    );
    return (
      'While this window was idle, the user continued this conversation remotely through Pocket Agent. ' +
      'Those turns ran in a separate process, so they are not in your context above. Any file changes ' +
      `they made are already on disk. Summary:\n\n${parts.join('\n\n')}`
    );
  }

  /**
   * Takes back a message Claude hasn't started on (to be edited in the app): it leaves the queue
   * and is reported Failed ("withdrawn"). False when it isn't waiting here.
   */
  withdraw(commandId: string): boolean {
    for (const w of this.woken.values()) {
      const i = w.inbox.findIndex((item) => item.commandId === commandId);
      if (i < 0) continue;
      w.inbox.splice(i, 1);
      this.ack(commandId, 'Failed', { error: 'withdrawn' });
      return true;
    }
    return false;
  }

  /**
   * A new mode or model for the session's woken process, at once: the turn that is running uses
   * it from its next step, and so do the turns after it. False when no process is open for it.
   */
  async configure(
    sessionId: string,
    change: { permissionMode?: TurnMode; model?: string },
  ): Promise<boolean> {
    const w = this.woken.get(sessionId);
    if (!w?.query || w.closed || w.finished) return false;
    if (change.permissionMode) {
      await w.query.setPermissionMode(change.permissionMode);
      w.mode = change.permissionMode;
    }
    if (change.model) {
      await w.query.setModel(change.model);
      w.model = change.model;
    }
    return true;
  }

  /** Stops the turn running for this session now, and drops what was queued behind it. */
  interrupt(sessionId: string): boolean {
    const w = this.woken.get(sessionId);
    if (!w) return false;
    w.interrupted = true;
    w.abort.abort();
    return true;
  }

  onSessionEnd(sessionId: string): void {
    this.woken.get(sessionId)?.abort.abort();
    this.missed.delete(sessionId);
    this.briefed.delete(sessionId);
  }

  stopAll(): void {
    for (const w of this.woken.values()) w.abort.abort();
  }

  // ── The woken process ──────────────────────────────────────────────────────────

  private start(sessionId: string, cwd: string, inbox: Item[]): void {
    const w: Woken = {
      cwd,
      inbox,
      current: null,
      query: null,
      abort: new AbortController(),
      effort: inbox[0]?.effort,
      mode: inbox[0]?.permissionMode,
      model: inbox[0]?.model,
      closed: false,
      interrupted: false,
      finished: false,
      reply: '',
      toolNames: new Map(),
    };
    this.woken.set(sessionId, w);
    // While this process is open, the app can switch its mode and model at once (configure).
    this.registry.setMetadata(sessionId, { [LIVE_SETTINGS_METADATA]: 'on' });
    const first = inbox[0];
    try {
      w.query = this.query({
        prompt: this.messages(sessionId, w),
        options: {
          cwd,
          resume: sessionId, // same session id, full history
          canUseTool: approvalGate(this.registry, sessionId, this.approvals, this.now),
          permissionMode: first?.permissionMode ?? 'default',
          abortController: w.abort,
          ...(first?.model ? { model: first.model } : {}),
          ...(w.effort ? { effort: w.effort } : {}),
          // Files sent from the app are saved under one folder: readable for every turn.
          ...(this.filesRoot
            ? { additionalDirectories: [this.filesRoot] }
            : filesDir(first?.files)
              ? { additionalDirectories: [filesDir(first?.files)!] }
              : {}),
          // Its hooks would report these turns a second time; the SDK stream already does.
          env: { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' },
        },
      });
    } catch (err) {
      this.log('error', `waking session ${sessionId} failed: ${(err as Error).message}`);
      this.finish(sessionId, w, 'session_error');
      return;
    }
    void this.consume(sessionId, w, w.query);
  }

  /** The process's input: each message once the previous turn is done; it ends when closed. */
  private async *messages(sessionId: string, w: Woken): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while ((w.current || !w.inbox.length) && !w.closed) {
        await new Promise<void>((r) => (w.next = r));
      }
      if (w.closed) return;
      const item = w.inbox.shift()!;
      if (item.expiresAt <= this.now()) {
        this.ack(item.commandId, 'Expired');
        continue; // never run an instruction late
      }
      if (w.idleTimer) clearTimeout(w.idleTimer);
      w.current = item;
      w.reply = '';
      this.ack(item.commandId, 'Executing');
      this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(item.text) });
      this.registry.setStatus(sessionId, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));
      // A later message may ask for another mode or model (the process started with the first's).
      if (item.permissionMode && item.permissionMode !== w.mode) {
        const mode = item.permissionMode;
        await Promise.resolve(w.query?.setPermissionMode(mode))
          .then(() => (w.mode = mode))
          .catch((err: Error) =>
            this.log('warn', `could not switch ${sessionId} to ${mode}: ${err.message}`),
          );
      }
      if (item.model && item.model !== w.model) {
        const model = item.model;
        await Promise.resolve(w.query?.setModel(model))
          .then(() => (w.model = model))
          .catch((err: Error) =>
            this.log('warn', `could not switch ${sessionId} to ${model}: ${err.message}`),
          );
      }
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: this.withBriefing(sessionId, messageContent(item.text, item.files)),
        },
        parent_tool_use_id: null,
      };
    }
  }

  /**
   * The session was started in the editor, so its system prompt knows nothing about the app: the
   * first message we run in it says where the user is. Once per session is enough.
   */
  private withBriefing(sessionId: string, content: ReturnType<typeof messageContent>) {
    if (this.briefed.has(sessionId)) return content;
    this.briefed.add(sessionId);
    const note = {
      type: 'text',
      text: `<pocket-agent-context>\n${APP_CONTEXT}\n</pocket-agent-context>`,
    } as const;
    return typeof content === 'string'
      ? [note, { type: 'text', text: content } as const]
      : [note, ...content];
  }

  private async consume(sessionId: string, w: Woken, q: Query): Promise<void> {
    let reason = 'completed';
    try {
      for await (const msg of q) {
        reportSdkMessage(this.registry, sessionId, w.toolNames, msg);
        if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'text' && b.text.trim()) w.reply = b.text;
        }
        if (msg.type === 'result') {
          if (msg.subtype !== 'success')
            this.registry.event(sessionId, 'agent.error', { message: `Turn ended: ${msg.subtype}` });
          this.turnDone(sessionId, w, msg.subtype === 'success' ? 'Completed' : 'Failed', msg.subtype);
        }
      }
    } catch (err) {
      reason = w.interrupted ? 'interrupted' : w.abort.signal.aborted ? 'session_ended' : 'session_error';
      if (!w.abort.signal.aborted) {
        this.log('error', `waking session ${sessionId} failed: ${(err as Error).message}`);
        this.registry.event(sessionId, 'agent.error', { message: truncate((err as Error).message) });
      }
    }
    this.finish(sessionId, w, reason);
  }

  /** A turn ended: it is reported, and the process waits for the next message (for a while). */
  private turnDone(sessionId: string, w: Woken, outcome: 'Completed' | 'Failed', error: string): void {
    const item = w.current;
    if (!item) return;
    // Stopped from Pocket Agent, however the turn ended: it fails, and so does what was queued.
    if (w.interrupted) {
      this.close(w);
      return this.finish(sessionId, w, 'interrupted');
    }
    w.current = null;
    this.onTurnEnd(sessionId);
    this.remember(sessionId, item, w.reply);
    this.registry.setStatus(sessionId, outcome === 'Completed' ? 'WaitingForInput' : 'Failed');
    this.ack(item.commandId, outcome, outcome === 'Failed' ? { error } : {});
    if (w.inbox.length) w.next?.();
    else this.closeWhenIdle(sessionId, w);
  }

  /** Nothing left to do: the process exits after `keepMs` (at once if it is already idle and closing). */
  private closeWhenIdle(sessionId: string, w: Woken): void {
    if (w.idleTimer) clearTimeout(w.idleTimer);
    // A message that needs a new process is waiting: close as soon as this one is idle.
    const mustRestart = w.inbox.some((i) => (i.effort ?? w.effort) !== w.effort);
    if (mustRestart && !w.current) return this.close(w);
    if (mustRestart) return;
    w.idleTimer = setTimeout(() => {
      if (!w.current && !w.inbox.length) this.close(w);
    }, this.keepMs);
    w.idleTimer.unref?.();
  }

  /** Ends the input stream: the process exits once its last turn is done. */
  private close(w: Woken): void {
    if (w.idleTimer) clearTimeout(w.idleTimer);
    w.closed = true;
    w.next?.();
  }

  /** The process is gone: what it was doing fails (or, closed with work left, a new one takes it). */
  private finish(sessionId: string, w: Woken, reason: string): void {
    if (w.finished) return;
    w.finished = true;
    if (w.idleTimer) clearTimeout(w.idleTimer);
    if (this.woken.get(sessionId) === w) {
      this.woken.delete(sessionId);
      this.registry.setMetadata(sessionId, { [LIVE_SETTINGS_METADATA]: 'off' });
    }
    const stopped = w.interrupted || w.abort.signal.aborted;
    if (w.current) {
      const item = w.current;
      w.current = null;
      this.onTurnEnd(sessionId);
      this.remember(sessionId, item, w.reply);
      this.ack(item.commandId, 'Failed', { error: w.interrupted ? 'interrupted' : reason });
    }
    if (w.interrupted) {
      this.registry.event(sessionId, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
      this.registry.setStatus(sessionId, 'WaitingForInput');
    } else if (reason === 'session_error') {
      this.registry.setStatus(sessionId, 'Failed');
    }
    // Closed on purpose with messages still waiting (a different effort): a new process runs them.
    if (!stopped && w.closed && w.inbox.length && reason === 'completed') {
      this.start(sessionId, w.cwd, w.inbox);
      return;
    }
    for (const item of w.inbox)
      this.ack(item.commandId, 'Failed', { error: w.interrupted ? 'interrupted' : 'session_ended' });
  }

  private remember(sessionId: string, item: Item, reply: string): void {
    const list = this.missed.get(sessionId) ?? [];
    list.push({ prompt: truncate(item.text, 1000), reply: truncate(reply, 1500) });
    this.missed.set(sessionId, list.slice(-MAX_MISSED));
  }
}
