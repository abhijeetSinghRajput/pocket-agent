import { APPROVAL_WAIT_MS, CLAUDE_CODE_CAPABILITIES } from '@pocket-agent/protocol';
import type { ApprovalBroker } from '../../approvals.js';
import { answeredQuestionInput } from '../../approvals.js';
import { appSystemPrompt } from './app-context.js';
import type { TurnEffort, TurnMode } from '@pocket-agent/protocol';
import { messageContent, type LocalFile } from '../../attachments.js';
import type { CanUseTool, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import type { CommandAck } from './instructions.js';
import { summarizeToolInput, summarizeToolOutput } from './summarize.js';

export type QueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

/** Message shown to Claude when remote approval is turned off on the PC. */
export const NO_APPROVAL_CHANNEL =
  'Pocket Agent denied this action: remote approval is turned off on this PC, and Pocket Agent never approves ' +
  'actions on its own. Continue without it, or ask the user to run this step themselves.';

/** Message shown to Claude when nobody decided in time. */
export const NO_DECISION_IN_TIME =
  'Pocket Agent denied this action: nobody approved it in time. Continue without it, or ask again later.';

export interface ManagedApprovalOptions {
  broker: ApprovalBroker;
  /** PC owner allowed remote approval (`pocket-agent approvals enable`). */
  enabled: () => boolean;
  waitMs?: number;
}

interface Instruction {
  text: string;
  /** The command it came from (absent for local `pocket-agent run`). */
  commandId?: string;
  expiresAt?: number;
  /** Switch the session to this model before running the instruction. */
  model?: string;
  /** And to this permission mode (never "bypass"). */
  permissionMode?: TurnMode;
  /** Files sent with the message. */
  files?: LocalFile[];
}

interface Managed {
  inbox: Instruction[];
  /** The instruction Claude is working on now (one turn at a time). */
  current: Instruction | null;
  turnActive: boolean;
  wake: (() => void) | null;
  closed: boolean;
  interrupted: boolean;
  abort: AbortController;
  query: Query | null;
  toolNames: Map<string, string>;
}

/**
 * Sessions Pocket Agent starts itself with the Claude Agent SDK: full control (instructions at any
 * time, interrupt, stop), and their events come from the SDK stream rather than hooks.
 * Claude Code's own settings (user/project/local) still apply — permission rules included.
 *
 * One instruction per turn: an instruction sent while Claude is idle starts a turn at once; one sent
 * mid-turn waits for that turn to finish (or for an interrupt). That keeps "this instruction
 * completed" meaningful.
 */
/**
 * Permission gate for turns Pocket Agent runs through the SDK (managed sessions and woken idle
 * sessions). Claude Code's own permission rules apply first; anything that would ask goes to
 * Pocket Agent only if the PC owner enabled remote approval — otherwise it is denied, never allowed.
 */
export function approvalGate(
  registry: SessionRegistry,
  id: string,
  approvals: ManagedApprovalOptions | undefined,
  now: () => number,
): CanUseTool {
  return async (toolName, toolInput, { toolUseID, signal }) => {
    const inputSummary = summarizeToolInput(toolName, toolInput);
    const remote = !!approvals?.enabled();
    const waitMs = approvals?.waitMs ?? APPROVAL_WAIT_MS.managed;
    registry.event(id, 'agent.permission.requested', {
      toolUseId: toolUseID,
      toolName,
      input: inputSummary,
      requestId: toolUseID,
      ...(remote ? { awaitingRemote: true, expiresAt: new Date(now() + waitMs).toISOString() } : {}),
    });
    if (!remote) {
      // No approval channel: deny, never allow.
      registry.event(id, 'agent.permission.resolved', { requestId: toolUseID, outcome: 'auto_denied' });
      return { behavior: 'deny', message: NO_APPROVAL_CHANNEL };
    }
    registry.setStatus(id, 'WaitingForPermission');
    const broker = approvals!.broker;
    const onAbort = () => broker.cancel(toolUseID); // interrupted / stopped
    signal.addEventListener('abort', onAbort, { once: true });
    const decision = await broker.wait(toolUseID, waitMs);
    signal.removeEventListener('abort', onAbort);
    if (!decision) {
      const outcome = signal.aborted ? 'cancelled' : 'timeout';
      registry.event(id, 'agent.permission.resolved', { requestId: toolUseID, outcome });
      return { behavior: 'deny', message: NO_DECISION_IN_TIME };
    }
    registry.event(id, 'agent.permission.resolved', { requestId: toolUseID, outcome: 'remote' });
    registry.setStatus(id, 'Running');
    if (decision.behavior !== 'allow') return { behavior: 'deny', message: decision.message };
    // Exactly what Claude asked for: the input is passed back unchanged, never modified. The one
    // exception is Claude's own question to the user, which gets the user's answers added.
    const answered = answeredQuestionInput(toolName, toolInput, decision.answers);
    return { behavior: 'allow', updatedInput: answered ?? toolInput };
  };
}

/** Reports Claude's text and tool calls/results from an SDK stream as session events. */
export function reportSdkMessage(
  registry: SessionRegistry,
  id: string,
  toolNames: Map<string, string>,
  msg: SDKMessage,
): void {
  if (msg.type === 'assistant') {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        registry.event(id, 'agent.output', { role: 'assistant', text: truncate(block.text) });
      } else if (block.type === 'tool_use') {
        toolNames.set(block.id, block.name);
        registry.event(id, 'agent.tool.started', {
          toolUseId: block.id,
          toolName: block.name,
          input: summarizeToolInput(block.name, block.input),
        });
      }
    }
    return;
  }
  if (msg.type !== 'user') return;
  const content = msg.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== 'object' || block.type !== 'tool_result') continue;
    const toolName = toolNames.get(block.tool_use_id) ?? 'unknown';
    const text =
      typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c) => ('text' in c && typeof c.text === 'string' ? c.text : '')).join('\n')
          : '';
    const base = { toolUseId: block.tool_use_id, toolName, input: '{}' };
    if (block.is_error) {
      registry.event(id, 'agent.tool.failed', { ...base, error: truncate(text || 'Tool failed', 2000) });
    } else {
      // The user's answers to Claude's question come as the structured result (shown in the chat).
      const structured = (msg as { tool_use_result?: unknown }).tool_use_result;
      registry.event(id, 'agent.tool.completed', {
        ...base,
        output: summarizeToolOutput(
          toolName,
          toolName === 'AskUserQuestion' && structured && typeof structured === 'object'
            ? structured
            : { stdout: text },
        ),
      });
    }
  }
}

export class ManagedSessions {
  private readonly sessions = new Map<string, Managed>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly ack: CommandAck = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
  ) {}

  /** Managed capabilities: remote approval only if the PC owner enabled it. */
  capabilities() {
    return { ...CLAUDE_CODE_CAPABILITIES.managed, remoteApproval: this.approvals?.enabled() ?? false };
  }

  /** Re-announces managed sessions after the PC's policy changed. */
  refreshCapabilities(): void {
    for (const t of this.registry.live()) {
      if (t.mode === 'managed')
        this.registry.announce({ ...t, capabilities: this.capabilities() }, 'managed');
    }
  }

  /** Where files sent with messages are saved: readable by sessions started here. */
  filesRoot: string | undefined;

  isManaged = (id: string) => this.sessions.has(id);

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /** Starts a session. The first instruction may carry the session.start command id. */
  async start(input: {
    projectPath: string;
    prompt: string;
    model?: string;
    permissionMode?: TurnMode;
    effort?: TurnEffort;
    commandId?: string;
    /** Continue this ended session (same id, full history) instead of starting a new one. */
    resumeSessionId?: string;
    /** Files sent with the first message. */
    files?: LocalFile[];
  }): Promise<string> {
    const projectPath = path.resolve(input.projectPath);
    const st = await stat(projectPath).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a directory: ${projectPath}`);

    // We choose the id up front so hooks and discovery recognise it as managed immediately.
    const id = input.resumeSessionId ?? randomUUID();
    if (this.sessions.has(id)) throw new Error('session_running');
    const m: Managed = {
      inbox: [],
      current: null,
      turnActive: false,
      wake: null,
      closed: false,
      interrupted: false,
      abort: new AbortController(),
      query: null,
      toolNames: new Map(),
    };
    this.sessions.set(id, m);

    this.registry.announce(
      {
        externalSessionId: id,
        provider: 'claude-code',
        mode: 'managed',
        projectPath,
        status: 'Starting',
        capabilities: this.capabilities(),
        metadata: {
          entrypoint: 'pocket-agent',
          ...(input.resumeSessionId ? { startSource: 'resume' } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
      },
      'managed',
    );

    const canUseTool = approvalGate(this.registry, id, this.approvals, this.now);

    m.query = this.query({
      prompt: this.messages(id, m),
      options: {
        cwd: projectPath,
        // Resuming keeps the session id and loads its conversation from this PC.
        ...(input.resumeSessionId ? { resume: id } : { sessionId: id }),
        canUseTool,
        permissionMode: input.permissionMode ?? 'default',
        abortController: m.abort,
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(this.filesRoot ? { additionalDirectories: [this.filesRoot] } : {}),
        // Started from the app: Claude is told the user is on their phone, away from this PC.
        ...(input.commandId ? { systemPrompt: appSystemPrompt } : {}),
        // Lets the hook relay skip this session (its events come from this stream).
        env: { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' },
      },
    });

    // The session.start command is already reported Executing by the caller (with the new id).
    this.enqueue(
      id,
      m,
      {
        text: input.prompt,
        ...(input.commandId ? { commandId: input.commandId } : {}),
        ...(input.files?.length ? { files: input.files } : {}),
      },
      false,
    );
    void this.consume(id, m, m.query);
    return id;
  }

  /** Queues an instruction; it runs as soon as Claude isn't busy with another one. */
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
    const m = this.sessions.get(id);
    if (!m || m.closed) return false;
    this.enqueue(id, m, { text, ...command }, true);
    return true;
  }

  /**
   * A new mode or model, at once: the turn that is running uses it from its next step (a mode
   * switched to Auto stops asking for what Auto allows), and so do the turns after it.
   */
  async configure(id: string, change: { permissionMode?: TurnMode; model?: string }): Promise<boolean> {
    const m = this.sessions.get(id);
    if (!m?.query || m.closed) return false;
    if (change.permissionMode) await m.query.setPermissionMode(change.permissionMode);
    if (change.model) await m.query.setModel(change.model);
    return true;
  }

  /** Stops the current turn; the session stays open for further instructions. */
  async interrupt(id: string): Promise<boolean> {
    const m = this.sessions.get(id);
    if (!m?.query || m.closed) return false;
    if (!m.turnActive) return true; // nothing running: nothing to interrupt
    m.interrupted = true;
    await m.query.interrupt();
    return true;
  }

  async stop(id: string): Promise<boolean> {
    const m = this.sessions.get(id);
    if (!m) return false;
    m.closed = true;
    m.wake?.();
    m.abort.abort();
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.ids().map((id) => this.stop(id)));
  }

  private enqueue(id: string, m: Managed, item: Instruction, ackAccepted: boolean): void {
    m.inbox.push(item);
    if (ackAccepted && item.commandId) this.ack(item.commandId, 'Accepted');
    m.wake?.();
  }

  private async *messages(id: string, m: Managed): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while ((m.turnActive || !m.inbox.length) && !m.closed) {
        await new Promise<void>((r) => (m.wake = r));
      }
      if (m.closed) return;
      const item = m.inbox.shift()!;
      if (item.expiresAt !== undefined && item.expiresAt <= this.now()) {
        if (item.commandId) this.ack(item.commandId, 'Expired');
        continue; // never run an instruction late
      }
      m.current = item;
      m.turnActive = true;
      m.interrupted = false;
      // session.start was already reported Executing; plain instructions are reported now.
      if (item.commandId && item.expiresAt !== undefined) this.ack(item.commandId, 'Executing');
      this.registry.event(id, 'agent.output', { role: 'user', text: truncate(item.text) });
      this.registry.setStatus(id, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));
      if (item.permissionMode) {
        await m.query?.setPermissionMode(item.permissionMode).catch((err: Error) => {
          this.log('warn', `could not switch ${id} to ${item.permissionMode}: ${err.message}`);
        });
      }
      if (item.model) {
        // Applies to this turn and the ones after it, like the model picker in the editor.
        await m.query?.setModel(item.model).catch((err: Error) => {
          this.log('warn', `could not switch ${id} to ${item.model}: ${err.message}`);
          this.registry.event(id, 'agent.error', { message: `Could not switch to ${item.model}` });
        });
      }
      yield {
        type: 'user',
        message: { role: 'user', content: messageContent(item.text, item.files) },
        parent_tool_use_id: null,
      };
    }
  }

  private finishTurn(m: Managed, outcome: 'Completed' | 'Failed', error?: string): void {
    if (m.current?.commandId) this.ack(m.current.commandId, outcome, error ? { error } : {});
    m.current = null;
    m.turnActive = false;
    m.wake?.();
  }

  private async consume(id: string, m: Managed, q: Query): Promise<void> {
    let reason = 'completed';
    try {
      for await (const msg of q) this.onMessage(id, m, msg);
    } catch (err) {
      if (m.abort.signal.aborted) reason = 'stopped';
      else {
        reason = 'error';
        this.log('error', `managed session ${id} failed: ${(err as Error).message}`);
        this.registry.event(id, 'agent.error', { message: truncate((err as Error).message) });
      }
    } finally {
      m.closed = true;
      // Anything still waiting will never run.
      if (m.current?.commandId) this.ack(m.current.commandId, 'Failed', { error: `session_${reason}` });
      for (const item of m.inbox)
        if (item.commandId) this.ack(item.commandId, 'Failed', { error: `session_${reason}` });
      this.sessions.delete(id);
      this.registry.end(id, reason);
    }
  }

  private onMessage(id: string, m: Managed, msg: SDKMessage): void {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') this.registry.setStatus(id, 'Running');
        // A sub-agent or workflow running in the background: its start and its end.
        const task = msg as { subtype: string; tool_use_id?: string; status?: string; summary?: string };
        if ((task.subtype === 'task_started' || task.subtype === 'task_notification') && task.tool_use_id) {
          this.registry.event(id, 'agent.worker.updated', {
            toolUseId: task.tool_use_id,
            status: task.subtype === 'task_started' ? 'running' : workerStatus(task.status),
            ...(task.summary ? { summary: truncate(task.summary, 500) } : {}),
          });
        }
        return;
      }
      case 'assistant':
      case 'user':
        reportSdkMessage(this.registry, id, m.toolNames, msg);
        return;
      case 'result':
        if (msg.subtype === 'success') {
          this.registry.setStatus(id, 'WaitingForInput');
          this.finishTurn(m, 'Completed');
        } else if (m.interrupted) {
          this.registry.event(id, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
          this.registry.setStatus(id, 'WaitingForInput');
          this.finishTurn(m, 'Failed', 'interrupted');
        } else {
          this.registry.event(id, 'agent.error', { message: `Turn ended: ${msg.subtype}` });
          this.registry.setStatus(id, 'Failed');
          this.finishTurn(m, 'Failed', msg.subtype);
        }
        return;
      default:
    }
  }
}

/** A task's end, in the words of Pocket Agent's worker list. */
export function workerStatus(status: string | undefined): 'done' | 'failed' | 'stopped' {
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'stopped' || status === 'killed' || status === 'cancelled') return 'stopped';
  return 'done';
}
