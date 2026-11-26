import {
  APPROVAL_WAIT_MS,
  isPreviewable,
  type SessionCapabilities,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import type { RemoteDecision } from '../../approvals.js';
import type { ManagedApprovalOptions } from '../claude-code/managed.js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { filesNote, type LocalFile } from '../../attachments.js';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { summarizeToolInput, summarizeToolOutput } from '../claude-code/summarize.js';
import type { CommandAck } from '../claude-code/instructions.js';
import { AppServerClient, spawnLines, type Transport } from '../codex/rpc.js';
import type { ManagedRuntime } from '../types.js';
import { antigravityCommand } from './detect.js';

/**
 * Chats with Antigravity CLI that this PC runs for Pocket Agent, through one `agy acp` process
 * (the Agent Client Protocol: JSON-RPC over stdio, started with the first chat). Each ACP session
 * is one chat; its id is the chat's id. Messages wait in the chat's queue and run one turn at a
 * time, like Claude Code's and Codex's.
 *
 * Antigravity keeps its own permission settings. When it asks before an action, the request goes
 * to the phone if the PC owner turned remote approval on (like Claude Code's and Codex's);
 * otherwise, or when nobody decides in time, it is declined and the chat says so.
 */

/** What an Antigravity chat can do from the phone (remote approval: when the PC owner turned it on). */
export const ANTIGRAVITY_CAPABILITIES: SessionCapabilities = {
  monitor: true,
  remoteApproval: false,
  instructAnytime: true,
  instructBetweenTurns: true,
  interrupt: true,
};

type Json = Record<string, unknown>;

/** The app's modes as Antigravity's own (the same four, by other names). */
export const ANTIGRAVITY_MODE: Record<TurnMode, string> = {
  default: 'default',
  acceptEdits: 'accept-edits',
  auto: 'auto',
  plan: 'plan',
};

interface Instruction {
  text: string;
  commandId?: string;
  /** Plain instructions expire; the message that starts the chat doesn't (already Executing). */
  expiresAt?: number;
  model?: string;
  permissionMode?: TurnMode;
  files?: LocalFile[];
}

interface Chat {
  id: string;
  inbox: Instruction[];
  current: Instruction | null;
  /** A turn is running (its session/prompt hasn't answered yet). */
  busy: boolean;
  interrupted: boolean;
  closed: boolean;
  /** Antigravity's reply so far, in pieces (said as one message). */
  text: string;
  /** Tool calls started, with what the chat showed for them. */
  tools: Map<string, { toolName: string; input: string }>;
  /** Permission requests waiting for the phone. */
  waiting: Set<string>;
  /** Model and mode in use (only sent again when they change). */
  model?: string;
  mode?: TurnMode;
}

export class AntigravitySessions implements ManagedRuntime {
  private readonly chats = new Map<string, Chat>();
  private client: Promise<AppServerClient> | null = null;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly connect: () => Transport = spawnAcp,
    private readonly version: string = '0.0.0',
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly ack: CommandAck = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
  ) {}

  /** Remote approval only when the PC owner turned it on. */
  private capabilities(): SessionCapabilities {
    return { ...ANTIGRAVITY_CAPABILITIES, remoteApproval: this.approvals?.enabled() ?? false };
  }

  /** Stops waiting for the phone on this chat's requests (they are declined). */
  private cancelWaiting(c: Chat): void {
    for (const requestId of [...c.waiting]) this.approvals?.broker.cancel(requestId);
  }

  isManaged = (id: string) => this.chats.has(id);

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
    const created = await client.request<{ sessionId: string; models?: { currentModelId?: string } }>(
      'session/new',
      { cwd: projectPath, mcpServers: [] },
    );
    const id = created.sessionId;
    const c: Chat = {
      id,
      inbox: [],
      current: null,
      busy: false,
      interrupted: false,
      closed: false,
      text: '',
      tools: new Map(),
      waiting: new Set(),
    };
    this.chats.set(id, c);
    const model = input.model ?? created.models?.currentModelId;
    this.registry.announce(
      {
        externalSessionId: id,
        provider: 'antigravity',
        mode: 'managed',
        projectPath,
        status: 'Starting',
        capabilities: this.capabilities(),
        metadata: { entrypoint: 'pocket-agent', ...(model ? { model } : {}) },
      },
      'managed',
    );
    // The session.start command is already reported Executing by the caller (with the new id).
    c.inbox.push({
      text: input.prompt,
      ...(input.commandId ? { commandId: input.commandId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.files?.length ? { files: input.files } : {}),
    });
    void this.pump(c);
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
    const c = this.chats.get(id);
    if (!c || c.closed) return false;
    const { effort: _effort, ...rest } = command ?? {};
    c.inbox.push({ text, ...rest });
    if (command?.commandId) this.ack(command.commandId, 'Accepted');
    void this.pump(c);
    return true;
  }

  /** A new model or mode applies from the next message. */
  async configure(id: string, change: { permissionMode?: TurnMode; model?: string }): Promise<boolean> {
    const c = this.chats.get(id);
    if (!c || c.closed) return false;
    try {
      await this.apply(c, change.model, change.permissionMode);
      return true;
    } catch (err) {
      this.log('warn', `antigravity configure ${id}: ${(err as Error).message}`);
      return false;
    }
  }

  async interrupt(id: string): Promise<boolean> {
    const c = this.chats.get(id);
    if (!c || c.closed) return false;
    if (!c.busy) return true; // idle: nothing to stop
    c.interrupted = true;
    this.cancelWaiting(c);
    const client = await this.client?.catch(() => null);
    client?.notify('session/cancel', { sessionId: id });
    return true;
  }

  /** Ends the chat here: what waits never runs. */
  async stop(id: string): Promise<boolean> {
    const c = this.chats.get(id);
    if (!c) return false;
    if (c.busy) await this.interrupt(id);
    const client = await this.client?.catch(() => null);
    await client?.request('session/close', { sessionId: id }, 10_000).catch(() => undefined);
    this.close(c, 'stopped');
    return true;
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.chats.keys()]) await this.stop(id);
    const client = await this.client?.catch(() => null);
    client?.close();
    this.client = null;
  }

  withdraw(commandId: string): boolean {
    for (const c of this.chats.values()) {
      const i = c.inbox.findIndex((x) => x.commandId === commandId);
      if (i < 0) continue;
      c.inbox.splice(i, 1);
      this.ack(commandId, 'Failed', { error: 'withdrawn' });
      return true;
    }
    return false;
  }

  // ── The ACP server ─────────────────────────────────────────────────────────

  private ensureClient(): Promise<AppServerClient> {
    this.client ??= (async () => {
      const client = new AppServerClient(
        this.connect(),
        {
          notification: (method, params) => this.onNotification(method, params),
          request: (method, params) => this.onRequest(method, params),
          closed: (reason) => {
            this.log('warn', `agy acp ${reason}`);
            this.client = null;
            for (const c of [...this.chats.values()]) this.close(c, 'error');
          },
        },
        this.log,
        { name: 'agy acp', jsonrpc: true },
      );
      try {
        await client.request('initialize', {
          protocolVersion: 1,
          // Antigravity uses its own file and terminal access on this PC (none is lent to it).
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version: this.version },
        });
      } catch (err) {
        client.close();
        this.client = null;
        throw err;
      }
      return client;
    })();
    return this.client;
  }

  /** Switches model or mode when they differ from what the chat uses. */
  private async apply(c: Chat, model: string | undefined, mode: TurnMode | undefined): Promise<void> {
    const client = await this.ensureClient();
    if (model && model !== c.model) {
      await client.request('session/set_model', { sessionId: c.id, modelId: model });
      c.model = model;
      this.registry.setMetadata(c.id, { model });
    }
    if (mode && mode !== c.mode) {
      await client.request('session/set_mode', { sessionId: c.id, modeId: ANTIGRAVITY_MODE[mode] });
      c.mode = mode;
    }
  }

  /** Runs the next waiting message when the chat is free. */
  private async pump(c: Chat): Promise<void> {
    while (!c.closed && !c.busy && c.inbox.length) {
      const item = c.inbox.shift()!;
      if (item.expiresAt !== undefined && item.expiresAt <= this.now()) {
        if (item.commandId) this.ack(item.commandId, 'Expired');
        continue; // never run an instruction late
      }
      c.current = item;
      c.busy = true;
      c.interrupted = false;
      c.text = '';
      // session.start was already reported Executing; plain instructions are reported now.
      if (item.commandId && item.expiresAt !== undefined) this.ack(item.commandId, 'Executing');
      this.registry.event(c.id, 'agent.output', { role: 'user', text: truncate(item.text) });
      this.registry.setStatus(c.id, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));
      let stopReason = '';
      let error: string | undefined;
      try {
        await this.apply(c, item.model, item.permissionMode);
        const client = await this.ensureClient();
        const res = await client.request<{ stopReason?: string }>(
          'session/prompt',
          { sessionId: c.id, prompt: await antigravityPrompt(item.text, item.files) },
          // A turn takes as long as it takes (the PC agent's own limits end a stuck one).
          6 * 60 * 60_000,
        );
        stopReason = String(res?.stopReason ?? '');
      } catch (err) {
        error = truncate((err as Error).message);
      }
      this.flushText(c);
      if (c.closed) return;
      if (error) {
        this.registry.event(c.id, 'agent.error', { message: error });
        this.registry.setStatus(c.id, 'Failed');
        this.finishTurn(c, 'Failed', 'turn_failed');
      } else if (stopReason === 'cancelled' || c.interrupted) {
        this.registry.event(c.id, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
        this.registry.setStatus(c.id, 'WaitingForInput');
        this.finishTurn(c, 'Failed', 'interrupted');
      } else if (
        stopReason === 'refusal' ||
        stopReason === 'max_tokens' ||
        stopReason === 'max_turn_requests'
      ) {
        this.registry.event(c.id, 'agent.error', {
          message: `Turn ended: ${stopReason.replaceAll('_', ' ')}`,
        });
        this.registry.setStatus(c.id, 'Failed');
        this.finishTurn(c, 'Failed', stopReason);
      } else {
        this.registry.setStatus(c.id, 'WaitingForInput');
        this.finishTurn(c, 'Completed');
      }
    }
  }

  private finishTurn(c: Chat, outcome: 'Completed' | 'Failed', error?: string): void {
    if (c.current?.commandId) this.ack(c.current.commandId, outcome, error ? { error } : {});
    c.current = null;
    c.busy = false;
    c.tools.clear();
    this.cancelWaiting(c);
    void this.pump(c);
  }

  private close(c: Chat, reason: string): void {
    if (c.closed) return;
    c.closed = true;
    if (c.current?.commandId) this.ack(c.current.commandId, 'Failed', { error: `session_${reason}` });
    for (const item of c.inbox)
      if (item.commandId) this.ack(item.commandId, 'Failed', { error: `session_${reason}` });
    c.inbox = [];
    this.cancelWaiting(c);
    this.chats.delete(c.id);
    this.registry.end(c.id, reason);
  }

  /** Antigravity's reply so far, said as one message (before a tool call, and at the turn's end). */
  private flushText(c: Chat): void {
    const text = c.text.trim();
    c.text = '';
    if (text) this.registry.event(c.id, 'agent.output', { role: 'assistant', text: truncate(text) });
  }

  private onNotification(method: string, params: Json): void {
    if (method !== 'session/update') return;
    const c = this.chats.get(String(params['sessionId'] ?? ''));
    if (!c) return;
    const u = (params['update'] ?? {}) as Json;
    switch (u['sessionUpdate']) {
      case 'agent_message_chunk': {
        const content = (u['content'] ?? {}) as Json;
        if (content['type'] === 'text' && typeof content['text'] === 'string') c.text += content['text'];
        return;
      }
      case 'tool_call':
      case 'tool_call_update':
        return this.tool(c, u);
      case 'session_info_update':
        if (typeof u['title'] === 'string' && u['title'])
          this.registry.setMetadata(c.id, { name: u['title'].slice(0, 200) });
        return;
      default:
    }
  }

  /** A tool call as the chat's tool events (started once; completed or failed once). */
  private tool(c: Chat, u: Json): void {
    const id = String(u['toolCallId'] ?? '');
    if (!id) return;
    const status = String(u['status'] ?? '');
    let shown = c.tools.get(id);
    if (!shown) {
      this.flushText(c);
      shown = describeTool(u);
      c.tools.set(id, shown);
      this.registry.event(c.id, 'agent.tool.started', { toolUseId: id, ...shown });
    }
    if (status !== 'completed' && status !== 'failed') return;
    if (shown.toolName === '') return; // already finished
    const base = { toolUseId: id, toolName: shown.toolName, input: shown.input };
    const out = toolOutput(u);
    if (status === 'failed')
      this.registry.event(c.id, 'agent.tool.failed', { ...base, error: truncate(out || 'Failed', 2000) });
    else
      this.registry.event(c.id, 'agent.tool.completed', {
        ...base,
        output: shown.toolName === 'Bash' ? summarizeToolOutput('Bash', { stdout: out }) : '',
      });
    c.tools.set(id, { toolName: '', input: '' });
  }

  /**
   * Requests from Antigravity. Asking before an action goes to the phone when the PC owner turned
   * remote approval on, and is declined otherwise (or when nobody decides in time); the chat says
   * so. Anything else Antigravity asks is not supported.
   */
  private async onRequest(method: string, params: Json): Promise<unknown> {
    const c = this.chats.get(String(params['sessionId'] ?? ''));
    if (method !== 'session/request_permission' || !c || c.closed)
      throw new Error(`${method} is not supported by Pocket Agent`);
    const options = Array.isArray(params['options']) ? (params['options'] as Json[]) : [];
    const call = (params['toolCall'] ?? {}) as Json;
    const what = describeTool(call);
    const toolCallId = String(call['toolCallId'] ?? '');
    // Unique on this PC: the chat's id, then the tool call's.
    const requestId = truncate(`${c.id}:${toolCallId || this.now()}`, 200);
    const remembers = options.some((o) => o['kind'] === 'allow_always');
    const remote = !!this.approvals?.enabled();
    const waitMs = this.approvals?.waitMs ?? APPROVAL_WAIT_MS.managed;
    this.flushText(c);
    this.registry.event(c.id, 'agent.permission.requested', {
      toolUseId: toolCallId || requestId,
      toolName: what.toolName,
      input: what.input,
      requestId,
      ...(remote
        ? {
            awaitingRemote: true,
            expiresAt: new Date(this.now() + waitMs).toISOString(),
            ...(remembers ? { remember: 'This action, for the rest of this chat' } : {}),
          }
        : {}),
    });
    const target = requestTarget(what);
    if (!remote) {
      this.registry.event(c.id, 'agent.permission.resolved', { requestId, outcome: 'auto_denied' });
      this.registry.event(c.id, 'agent.output', {
        role: 'system',
        text: `Antigravity asked before it would use ${what.toolName} (${truncate(target, 300)}). It was declined: remote approval is turned off on this PC.`,
      });
      return antigravityAnswer(options, null);
    }
    this.registry.setStatus(c.id, 'WaitingForPermission');
    c.waiting.add(requestId);
    const decision = await this.approvals!.broker.wait(requestId, waitMs);
    c.waiting.delete(requestId);
    if (!decision) {
      const outcome = c.interrupted || c.closed ? 'cancelled' : 'timeout';
      this.registry.event(c.id, 'agent.permission.resolved', { requestId, outcome });
      if (outcome === 'timeout')
        this.registry.event(c.id, 'agent.output', {
          role: 'system',
          text: `Antigravity asked before it would use ${what.toolName} (${truncate(target, 300)}). Nobody decided in time, so it was declined.`,
        });
    } else {
      this.registry.event(c.id, 'agent.permission.resolved', { requestId, outcome: 'remote' });
    }
    if (!c.closed && c.busy && !c.waiting.size) this.registry.setStatus(c.id, 'Running');
    return antigravityAnswer(options, decision);
  }
}

/** What a request is about, in a few words for the chat (the command, file or page). */
function requestTarget(what: { toolName: string; input: string }): string {
  try {
    const i = JSON.parse(what.input) as Json;
    return String(i['command'] ?? i['file_path'] ?? i['url'] ?? i['pattern'] ?? what.toolName);
  } catch {
    return what.toolName;
  }
}

/**
 * The phone's decision as one of the options Antigravity offered: allow once (or always, for
 * "Allow for this chat", when offered), else reject. Nothing offered: cancelled.
 */
export function antigravityAnswer(options: Json[], decision: RemoteDecision | null): Json {
  const pick = (...kinds: string[]) => kinds.map((k) => options.find((o) => o['kind'] === k)).find(Boolean);
  const allow = decision?.behavior === 'allow';
  const option = allow
    ? decision.remember
      ? pick('allow_always', 'allow_once')
      : pick('allow_once')
    : pick('reject_once', 'reject_always');
  return option
    ? { outcome: { outcome: 'selected', optionId: option['optionId'] } }
    : { outcome: { outcome: 'cancelled' } };
}

/** Starts `agy acp` (the real program, not a shim: no shell). */
export function spawnAcp(): Transport {
  return spawnLines(antigravityCommand(), ['acp'], false);
}

/** "/C:/x/y.txt" (as Antigravity writes some paths) → "C:/x/y.txt". */
const cleanPath = (p: unknown) =>
  typeof p === 'string' ? p.replace(/^\/([A-Za-z]:[\\/])/, '$1') : undefined;

/** A tool call in the tool words the app draws (only commands, paths and queries are shown). */
export function describeTool(u: Json): { toolName: string; input: string } {
  const raw = ((u['rawInput'] ?? u['args'] ?? {}) as Json) || {};
  const locations = Array.isArray(u['locations']) ? (u['locations'] as Json[]) : [];
  const file =
    cleanPath(locations[0]?.['path']) ?? cleanPath(raw['Path'] ?? raw['AbsolutePath'] ?? raw['TargetFile']);
  const name = String(u['name'] ?? '');
  switch (u['kind']) {
    case 'execute':
      return {
        toolName: 'Bash',
        input: summarizeToolInput('Bash', { command: raw['CommandLine'] ?? raw['command'] ?? u['title'] }),
      };
    case 'edit': {
      const toolName = name === 'write_file' ? 'Write' : 'Edit';
      return { toolName, input: summarizeToolInput(toolName, { file_path: file }) };
    }
    case 'read':
      return { toolName: 'Read', input: summarizeToolInput('Read', { file_path: file }) };
    case 'search':
      return { toolName: 'Grep', input: summarizeToolInput('Grep', { pattern: raw['Query'] ?? u['title'] }) };
    case 'fetch':
      return {
        toolName: 'WebFetch',
        input: summarizeToolInput('WebFetch', { url: raw['Url'] ?? raw['url'] ?? u['title'] }),
      };
    default:
      return { toolName: name || 'tool', input: summarizeToolInput(name || 'tool', raw) };
  }
}

/** What a finished tool said (its output, or why it failed). */
function toolOutput(u: Json): string {
  if (typeof u['rawOutput'] === 'string') return u['rawOutput'];
  const content = Array.isArray(u['content']) ? (u['content'] as Json[]) : [];
  return content
    .map((x) => ((x['content'] ?? {}) as Json)['text'])
    .filter((t): t is string => typeof t === 'string')
    .join('\n');
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The message as ACP prompt blocks: pictures as images, other files named for Antigravity to open. */
export async function antigravityPrompt(text: string, files: LocalFile[] | undefined): Promise<Json[]> {
  const images: Json[] = [];
  const others: LocalFile[] = [];
  for (const f of files ?? []) {
    const image = isPreviewable(f.ref.mime) && f.ref.mime !== 'application/pdf';
    const data = image ? await readFile(f.path).catch(() => null) : null;
    if (data && data.length <= MAX_IMAGE_BYTES)
      images.push({ type: 'image', mimeType: f.ref.mime, data: data.toString('base64') });
    else others.push(f);
  }
  return [...images, { type: 'text', text: text + filesNote(others) }];
}
