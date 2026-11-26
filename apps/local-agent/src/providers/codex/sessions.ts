import {
  APPROVAL_WAIT_MS,
  isPreviewable,
  type SessionCapabilities,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { filesNote, type LocalFile } from '../../attachments.js';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { summarizeToolInput, summarizeToolOutput } from '../claude-code/summarize.js';
import type { CommandAck } from '../claude-code/instructions.js';
import type { ManagedApprovalOptions } from '../claude-code/managed.js';
import type { ManagedRuntime } from '../types.js';
import { codexAnswer, isCodexApproval, readCodexRequest } from './approvals.js';
import { AppServerClient, type Transport } from './rpc.js';

/**
 * Chats with Codex that this PC runs for Pocket Agent, through one `codex app-server` process
 * (started when the first chat starts). Each Codex thread is one chat; its id is the chat's id.
 * Messages wait in the chat's queue and run one turn at a time, like Claude Code's.
 *
 * Codex works in its sandbox (it may edit files in the project; anything more needs approval).
 * Such a request goes to the phone when the PC owner turned remote approval on (like Claude
 * Code's); otherwise, or when nobody decides in time, it is declined and the chat says so.
 * Nothing ever runs with less protection than Codex's own default.
 */

/** What a Codex chat can do from the phone (remote approval: when the PC owner turned it on). */
export const CODEX_CAPABILITIES: SessionCapabilities = {
  monitor: true,
  remoteApproval: false,
  instructAnytime: true,
  instructBetweenTurns: true,
  interrupt: true,
};

/** Codex is told the user is on their phone (like Claude Code's app context). */
export const CODEX_APP_CONTEXT = `The user is talking to you through Pocket Agent, a phone app that controls this Codex session remotely. They are away from this PC.

- They can't see this PC: not its screen, editor, browser or terminal, and they can't click a dialog on it. Don't ask them to open, run or look at something here. Do it yourself, or say plainly what is blocked.
- They read your replies on a phone. Lead with the outcome, keep it short, and avoid wide tables and long code dumps unless they ask.
- They can attach photos and files to a message; those arrive with it.
- They can't open files on this PC from the phone. When you produce something to look at, say what it is and where you saved it.`;

type Json = Record<string, unknown>;

interface Instruction {
  text: string;
  commandId?: string;
  /** Plain instructions expire; the message that starts the chat doesn't (already Executing). */
  expiresAt?: number;
  model?: string;
  effort?: TurnEffort;
  files?: LocalFile[];
}

interface Thread {
  id: string;
  inbox: Instruction[];
  current: Instruction | null;
  /** The running turn (null: idle). */
  turnId: string | null;
  /** A turn was asked for and hasn't started yet. */
  starting: boolean;
  interrupted: boolean;
  closed: boolean;
  /** The error already shown for the running turn (its end repeats it). */
  lastError?: string;
  /** Model and effort for the next turns (the last ones chosen). */
  model?: string;
  effort?: TurnEffort;
  /** Files of the running turn's file changes, by item (a file change request names only its item). */
  files: Map<string, string[]>;
  /** Approval requests waiting for the phone. */
  waiting: Set<string>;
}

export class CodexSessions implements ManagedRuntime {
  private readonly threads = new Map<string, Thread>();
  private client: Promise<AppServerClient> | null = null;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly connect: () => Transport,
    private readonly version: string,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly ack: CommandAck = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
  ) {}

  /** Remote approval only when the PC owner turned it on. */
  private capabilities(): SessionCapabilities {
    return { ...CODEX_CAPABILITIES, remoteApproval: this.approvals?.enabled() ?? false };
  }

  isManaged = (id: string) => this.threads.has(id);

  async start(input: {
    projectPath: string;
    prompt: string;
    model?: string;
    permissionMode?: TurnMode;
    effort?: TurnEffort;
    commandId?: string;
    resumeSessionId?: string;
    files?: LocalFile[];
  }): Promise<string> {
    if (input.resumeSessionId) throw new Error('not_supported');
    const projectPath = path.resolve(input.projectPath);
    const st = await stat(projectPath).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a directory: ${projectPath}`);
    const client = await this.ensureClient();
    const started = await client.request<{ thread: { id: string }; model?: string }>('thread/start', {
      cwd: projectPath,
      // Codex's own default protection: it asks before anything outside the project's sandbox.
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      ...(input.model ? { model: input.model } : {}),
      developerInstructions: CODEX_APP_CONTEXT,
    });
    const id = started.thread.id;
    const t: Thread = {
      id,
      inbox: [],
      current: null,
      turnId: null,
      starting: false,
      interrupted: false,
      closed: false,
      files: new Map(),
      waiting: new Set(),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
    };
    this.threads.set(id, t);
    this.registry.announce(
      {
        externalSessionId: id,
        provider: 'codex',
        mode: 'managed',
        projectPath,
        status: 'Starting',
        capabilities: this.capabilities(),
        metadata: {
          entrypoint: 'pocket-agent',
          ...((input.model ?? started.model) ? { model: (input.model ?? started.model)! } : {}),
        },
      },
      'managed',
    );
    // The session.start command is already reported Executing by the caller (with the new id).
    t.inbox.push({
      text: input.prompt,
      ...(input.commandId ? { commandId: input.commandId } : {}),
      ...(input.files?.length ? { files: input.files } : {}),
    });
    void this.pump(t);
    return id;
  }

  send(
    id: string,
    text: string,
    command?: {
      commandId: string;
      expiresAt: number;
      model?: string;
      permissionMode?: TurnMode;
      effort?: TurnEffort;
      files?: LocalFile[];
    },
  ): boolean {
    const t = this.threads.get(id);
    if (!t || t.closed) return false;
    const { permissionMode: _mode, ...rest } = command ?? {};
    t.inbox.push({ text, ...rest });
    if (command?.commandId) this.ack(command.commandId, 'Accepted');
    void this.pump(t);
    return true;
  }

  /** A new model applies from the next turn (a mode is Codex's approval setting: not yet). */
  async configure(id: string, change: { permissionMode?: TurnMode; model?: string }): Promise<boolean> {
    const t = this.threads.get(id);
    if (!t || t.closed) return false;
    if (change.model) t.model = change.model;
    return true;
  }

  async interrupt(id: string): Promise<boolean> {
    const t = this.threads.get(id);
    if (!t || t.closed) return false;
    if (!t.turnId) return true; // idle: nothing to stop
    t.interrupted = true;
    this.cancelWaiting(t);
    const client = await this.client;
    await client?.request('turn/interrupt', { threadId: id, turnId: t.turnId }).catch((err: Error) => {
      this.log('warn', `codex interrupt ${id}: ${err.message}`);
    });
    return true;
  }

  /** Ends the chat here: what waits never runs; the thread stays in Codex's own history. */
  async stop(id: string): Promise<boolean> {
    const t = this.threads.get(id);
    if (!t) return false;
    if (t.turnId) await this.interrupt(id);
    const client = await this.client;
    await client?.request('thread/unsubscribe', { threadId: id }).catch(() => undefined);
    this.close(t, 'stopped');
    return true;
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.threads.keys()]) await this.stop(id);
    const client = await this.client?.catch(() => null);
    client?.close();
    this.client = null;
  }

  withdraw(commandId: string): boolean {
    for (const t of this.threads.values()) {
      const i = t.inbox.findIndex((x) => x.commandId === commandId);
      if (i < 0) continue;
      t.inbox.splice(i, 1);
      this.ack(commandId, 'Failed', { error: 'withdrawn' });
      return true;
    }
    return false;
  }

  // ── The app-server ─────────────────────────────────────────────────────────

  private ensureClient(): Promise<AppServerClient> {
    this.client ??= (async () => {
      const client = new AppServerClient(
        this.connect(),
        {
          notification: (method, params) => this.onNotification(method, params),
          request: (method, params) => this.onRequest(method, params),
          closed: (reason) => {
            this.log('warn', `codex app-server ${reason}`);
            this.client = null;
            for (const t of [...this.threads.values()]) this.close(t, 'error');
          },
        },
        this.log,
      );
      try {
        await client.initialize(this.version);
      } catch (err) {
        client.close();
        this.client = null;
        throw err;
      }
      return client;
    })();
    return this.client;
  }

  /** Runs the next waiting message when the chat is free. */
  private async pump(t: Thread): Promise<void> {
    while (!t.closed && !t.turnId && !t.starting && t.inbox.length) {
      const item = t.inbox.shift()!;
      if (item.expiresAt !== undefined && item.expiresAt <= this.now()) {
        if (item.commandId) this.ack(item.commandId, 'Expired');
        continue; // never run an instruction late
      }
      t.current = item;
      t.starting = true;
      t.interrupted = false;
      t.lastError = undefined;
      if (item.model) t.model = item.model;
      if (item.effort) t.effort = item.effort;
      // session.start was already reported Executing; plain instructions are reported now.
      if (item.commandId && item.expiresAt !== undefined) this.ack(item.commandId, 'Executing');
      this.registry.event(t.id, 'agent.output', { role: 'user', text: truncate(item.text) });
      this.registry.setStatus(t.id, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));
      try {
        const client = await this.ensureClient();
        const res = await client.request<{ turn: { id: string } }>('turn/start', {
          threadId: t.id,
          input: codexInput(item.text, item.files),
          ...(t.model ? { model: t.model } : {}),
          ...(t.effort ? { effort: t.effort } : {}),
        });
        t.turnId ??= res.turn.id;
      } catch (err) {
        this.registry.event(t.id, 'agent.error', { message: truncate((err as Error).message) });
        this.registry.setStatus(t.id, 'Failed');
        this.finishTurn(t, 'Failed', 'turn_start_failed');
      } finally {
        t.starting = false;
      }
    }
  }

  /** Stops waiting for the phone on this chat's requests (they are declined). */
  private cancelWaiting(t: Thread): void {
    for (const requestId of [...t.waiting]) this.approvals?.broker.cancel(requestId);
  }

  private finishTurn(t: Thread, outcome: 'Completed' | 'Failed', error?: string): void {
    this.cancelWaiting(t);
    t.files.clear();
    if (t.current?.commandId) this.ack(t.current.commandId, outcome, error ? { error } : {});
    t.current = null;
    t.turnId = null;
    void this.pump(t);
  }

  private close(t: Thread, reason: string): void {
    if (t.closed) return;
    t.closed = true;
    this.cancelWaiting(t);
    if (t.current?.commandId) this.ack(t.current.commandId, 'Failed', { error: `session_${reason}` });
    for (const item of t.inbox)
      if (item.commandId) this.ack(item.commandId, 'Failed', { error: `session_${reason}` });
    t.inbox = [];
    this.threads.delete(t.id);
    this.registry.end(t.id, reason);
  }

  private onNotification(method: string, params: Json): void {
    const t = this.threads.get(String(params['threadId'] ?? ''));
    if (!t) return;
    switch (method) {
      case 'turn/started':
        t.turnId = String((params['turn'] as Json | undefined)?.['id'] ?? t.turnId ?? '');
        return;
      case 'item/started': {
        const item = params['item'] as Json | undefined;
        if (item?.['type'] === 'fileChange' && Array.isArray(item['changes'])) {
          const paths = (item['changes'] as Json[]).map((c) => String(c['path'] ?? '')).filter(Boolean);
          t.files.set(String(item['id'] ?? ''), paths);
        }
        return reportItem(this.registry, t.id, item, 'started');
      }
      case 'item/completed':
        return reportItem(this.registry, t.id, params['item'] as Json, 'completed');
      case 'error': {
        if (params['willRetry'] === true) return;
        const error = params['error'] as Json | undefined;
        t.lastError = truncate(String(error?.['message'] ?? 'Codex error'));
        this.registry.event(t.id, 'agent.error', { message: t.lastError });
        return;
      }
      case 'turn/completed': {
        const turn = (params['turn'] ?? {}) as Json;
        const status = String(turn['status'] ?? '');
        if (status === 'completed') {
          this.registry.setStatus(t.id, 'WaitingForInput');
          this.finishTurn(t, 'Completed');
        } else if (status === 'interrupted' || t.interrupted) {
          this.registry.event(t.id, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
          this.registry.setStatus(t.id, 'WaitingForInput');
          this.finishTurn(t, 'Failed', 'interrupted');
        } else {
          const error = turn['error'] as Json | null | undefined;
          const message = truncate(String(error?.['message'] ?? `Turn ended: ${status || 'failed'}`));
          // Already said by Codex's error notice: not twice.
          if (message !== t.lastError) this.registry.event(t.id, 'agent.error', { message });
          this.registry.setStatus(t.id, 'Failed');
          this.finishTurn(t, 'Failed', status || 'failed');
        }
        return;
      }
      default:
    }
  }

  /**
   * Requests from Codex. Going beyond its sandbox goes to the phone when the PC owner turned remote
   * approval on, and is declined otherwise (or when nobody decides in time); the chat says so.
   * Anything else Codex asks is not supported (answered with an error).
   */
  private async onRequest(method: string, params: Json): Promise<unknown> {
    const t = this.threads.get(String(params['threadId'] ?? ''));
    if (!isCodexApproval(method) || !t || t.closed) {
      throw new Error(`${method} is not supported by Pocket Agent`);
    }
    const req = readCodexRequest(method, params, t.files.get(String(params['itemId'] ?? '')));
    const remote = !!this.approvals?.enabled();
    const waitMs = this.approvals?.waitMs ?? APPROVAL_WAIT_MS.managed;
    this.registry.event(t.id, 'agent.permission.requested', {
      toolUseId: req.itemId || req.requestId,
      toolName: req.toolName,
      input: req.input,
      requestId: req.requestId,
      ...(remote
        ? {
            awaitingRemote: true,
            expiresAt: new Date(this.now() + waitMs).toISOString(),
            remember: req.remember,
          }
        : {}),
    });
    if (!remote) {
      this.registry.event(t.id, 'agent.permission.resolved', {
        requestId: req.requestId,
        outcome: 'auto_denied',
      });
      this.registry.event(t.id, 'agent.output', {
        role: 'system',
        text: `Codex asked to ${req.what}, beyond what its sandbox allows. It was declined: remote approval is turned off on this PC.`,
      });
      return codexAnswer(method, params, null);
    }
    this.registry.setStatus(t.id, 'WaitingForPermission');
    t.waiting.add(req.requestId);
    const decision = await this.approvals!.broker.wait(req.requestId, waitMs);
    t.waiting.delete(req.requestId);
    if (!decision) {
      const outcome = t.interrupted || t.closed ? 'cancelled' : 'timeout';
      this.registry.event(t.id, 'agent.permission.resolved', { requestId: req.requestId, outcome });
      if (outcome === 'timeout') {
        this.registry.event(t.id, 'agent.output', {
          role: 'system',
          text: `Codex asked to ${req.what}. Nobody decided in time, so it was declined.`,
        });
      }
    } else {
      this.registry.event(t.id, 'agent.permission.resolved', { requestId: req.requestId, outcome: 'remote' });
    }
    if (!t.closed && t.turnId && !t.waiting.size) this.registry.setStatus(t.id, 'Running');
    return codexAnswer(method, params, decision);
  }
}

/** The message as Codex input: pictures as images, other files named for Codex to open. */
export function codexInput(text: string, files: LocalFile[] | undefined): Json[] {
  const images = (files ?? []).filter((f) => isPreviewable(f.ref.mime) && f.ref.mime !== 'application/pdf');
  const others = (files ?? []).filter((f) => !images.includes(f));
  return [
    ...images.map((f) => ({ type: 'localImage', path: f.path })),
    { type: 'text', text: text + filesNote(others), text_elements: [] },
  ];
}

/**
 * Codex's items as the chat's events, in the tool words the app already draws: a command is
 * "Bash", a changed file "Edit" (a new one "Write"), an MCP tool `mcp__<server>__<tool>`.
 * Only commands, paths and summaries leave the PC, never file contents.
 */
export function reportItem(
  registry: SessionRegistry,
  id: string,
  item: Json | undefined,
  phase: 'started' | 'completed',
): void {
  if (!item) return;
  const itemId = String(item['id'] ?? '');
  const status = String(item['status'] ?? '');
  const failed = status === 'failed' || status === 'declined';
  const tool = (toolUseId: string, toolName: string, input: unknown, output?: string, error?: string) => {
    const base = { toolUseId, toolName, input: summarizeToolInput(toolName, input) };
    if (phase === 'started') return registry.event(id, 'agent.tool.started', base);
    if (failed)
      return registry.event(id, 'agent.tool.failed', { ...base, error: truncate(error || status, 2000) });
    registry.event(id, 'agent.tool.completed', { ...base, output: output ?? '' });
  };
  switch (item['type']) {
    case 'agentMessage': {
      const text = String(item['text'] ?? '');
      if (phase === 'completed' && text.trim())
        registry.event(id, 'agent.output', { role: 'assistant', text: truncate(text) });
      return;
    }
    case 'commandExecution': {
      const out = String(item['aggregatedOutput'] ?? '');
      return tool(
        itemId,
        'Bash',
        { command: item['command'] },
        summarizeToolOutput('Bash', { stdout: out }),
        status === 'declined' ? 'Declined' : `Exit code ${String(item['exitCode'] ?? '?')}\n${out}`,
      );
    }
    case 'fileChange': {
      const changes = Array.isArray(item['changes']) ? (item['changes'] as Json[]) : [];
      changes.slice(0, 20).forEach((c, i) => {
        const kind = (c['kind'] as Json | undefined)?.['type'];
        tool(
          `${itemId}:${i}`,
          kind === 'add' ? 'Write' : 'Edit',
          { file_path: c['path'] },
          undefined,
          status === 'declined' ? 'Declined' : 'The change could not be applied',
        );
      });
      return;
    }
    case 'mcpToolCall':
      return tool(itemId, `mcp__${String(item['server'] ?? 'mcp')}__${String(item['tool'] ?? 'tool')}`, {});
    case 'webSearch':
      return tool(itemId, 'WebSearch', { query: item['query'] });
    default:
  }
}
