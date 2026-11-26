import {
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
import type { ManagedRuntime } from '../types.js';
import { AppServerClient, type Transport } from './rpc.js';

/**
 * Chats with Codex that this PC runs for Pocket Agent, through one `codex app-server` process
 * (started when the first chat starts). Each Codex thread is one chat; its id is the chat's id.
 * Messages wait in the chat's queue and run one turn at a time, like Claude Code's.
 *
 * Codex works in its sandbox (it may edit files in the project; anything more needs approval).
 * Approving from the phone comes next: until then such a request is declined, and the chat says
 * so. Nothing ever runs with less protection than Codex's own default.
 */

/** What a Codex chat can do from the phone (approvals from the phone: not yet). */
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
  ) {}

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
        capabilities: CODEX_CAPABILITIES,
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

  private finishTurn(t: Thread, outcome: 'Completed' | 'Failed', error?: string): void {
    if (t.current?.commandId) this.ack(t.current.commandId, outcome, error ? { error } : {});
    t.current = null;
    t.turnId = null;
    void this.pump(t);
  }

  private close(t: Thread, reason: string): void {
    if (t.closed) return;
    t.closed = true;
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
      case 'item/started':
        return reportItem(this.registry, t.id, params['item'] as Json, 'started');
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
   * Requests from Codex. Asking to go beyond its sandbox is declined for now (approving from the
   * phone comes next) and the chat says so; nothing else is answered.
   */
  private async onRequest(method: string, params: Json): Promise<unknown> {
    const id = String(params['threadId'] ?? '');
    const what =
      method === 'item/commandExecution/requestApproval'
        ? `run \`${truncate(String(params['command'] ?? 'a command'), 300)}\``
        : method === 'item/fileChange/requestApproval'
          ? 'change files outside the project'
          : method === 'item/permissions/requestApproval'
            ? 'get more permissions'
            : null;
    if (what && this.threads.has(id)) {
      this.registry.event(id, 'agent.output', {
        role: 'system',
        text: `Codex asked to ${what}, beyond what its sandbox allows. It was declined: approving Codex from the phone isn't available yet.`,
      });
      return { decision: 'decline' };
    }
    throw new Error(`${method} is not supported by Pocket Agent`);
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
