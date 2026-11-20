import { CLAUDE_CODE_CAPABILITIES } from '@agentdock/protocol';
import type { CanUseTool, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import type { CommandAck } from './instructions.js';
import { summarizeToolInput, summarizeToolOutput } from './summarize.js';

export type QueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

/** Message shown to Claude when a managed session asks for permission before M5. */
export const NO_APPROVAL_CHANNEL =
  'AgentDock denied this action: remote approval is not available yet, and AgentDock never approves ' +
  'actions on its own. Continue without it, or ask the user to run this step themselves.';

interface Instruction {
  text: string;
  /** The command it came from (absent for local `agentdock run`). */
  commandId?: string;
  expiresAt?: number;
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
 * Sessions AgentDock starts itself with the Claude Agent SDK: full control (instructions at any
 * time, interrupt, stop), and their events come from the SDK stream rather than hooks.
 * Claude Code's own settings (user/project/local) still apply — permission rules included.
 *
 * One instruction per turn: an instruction sent while Claude is idle starts a turn at once; one sent
 * mid-turn waits for that turn to finish (or for an interrupt). That keeps "this instruction
 * completed" meaningful.
 */
export class ManagedSessions {
  private readonly sessions = new Map<string, Managed>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly ack: CommandAck = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  isManaged = (id: string) => this.sessions.has(id);

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /** Starts a session. The first instruction may carry the session.start command id. */
  async start(input: {
    projectPath: string;
    prompt: string;
    model?: string;
    commandId?: string;
  }): Promise<string> {
    const projectPath = path.resolve(input.projectPath);
    const st = await stat(projectPath).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a directory: ${projectPath}`);

    // We choose the id up front so hooks and discovery recognise it as managed immediately.
    const id = randomUUID();
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
        capabilities: CLAUDE_CODE_CAPABILITIES.managed,
        metadata: { entrypoint: 'agentdock', ...(input.model ? { model: input.model } : {}) },
      },
      'managed',
    );

    const canUseTool: CanUseTool = async (toolName, toolInput, { toolUseID }) => {
      const inputSummary = summarizeToolInput(toolName, toolInput);
      this.registry.event(id, 'agent.permission.requested', {
        toolUseId: toolUseID,
        toolName,
        input: inputSummary,
        requestId: toolUseID,
      });
      // Remote approval arrives in M5. Until then: deny, never allow.
      this.registry.event(id, 'agent.permission.resolved', { requestId: toolUseID, outcome: 'auto_denied' });
      return { behavior: 'deny', message: NO_APPROVAL_CHANNEL };
    };

    m.query = this.query({
      prompt: this.messages(id, m),
      options: {
        cwd: projectPath,
        sessionId: id,
        canUseTool,
        permissionMode: 'default',
        abortController: m.abort,
        ...(input.model ? { model: input.model } : {}),
        // Lets the hook relay skip this session (its events come from this stream).
        env: { ...process.env, AGENTDOCK_MANAGED_SESSION: '1' },
      },
    });

    // The session.start command is already reported Executing by the caller (with the new id).
    this.enqueue(
      id,
      m,
      { text: input.prompt, ...(input.commandId ? { commandId: input.commandId } : {}) },
      false,
    );
    void this.consume(id, m, m.query);
    return id;
  }

  /** Queues an instruction; it runs as soon as Claude isn't busy with another one. */
  send(id: string, text: string, command?: { commandId: string; expiresAt: number }): boolean {
    const m = this.sessions.get(id);
    if (!m || m.closed) return false;
    this.enqueue(id, m, { text, ...command }, true);
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
      yield { type: 'user', message: { role: 'user', content: item.text }, parent_tool_use_id: null };
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
      case 'system':
        if (msg.subtype === 'init') this.registry.setStatus(id, 'Running');
        return;
      case 'assistant':
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            this.registry.event(id, 'agent.output', { role: 'assistant', text: truncate(block.text) });
          } else if (block.type === 'tool_use') {
            m.toolNames.set(block.id, block.name);
            this.registry.event(id, 'agent.tool.started', {
              toolUseId: block.id,
              toolName: block.name,
              input: summarizeToolInput(block.name, block.input),
            });
          }
        }
        return;
      case 'user': {
        const content = msg.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (typeof block !== 'object' || block.type !== 'tool_result') continue;
          const toolName = m.toolNames.get(block.tool_use_id) ?? 'unknown';
          const text =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : ''))
                    .join('\n')
                : '';
          const base = { toolUseId: block.tool_use_id, toolName, input: '{}' };
          if (block.is_error) {
            this.registry.event(id, 'agent.tool.failed', {
              ...base,
              error: truncate(text || 'Tool failed', 2000),
            });
          } else {
            this.registry.event(id, 'agent.tool.completed', {
              ...base,
              output: summarizeToolOutput(toolName, { stdout: text }),
            });
          }
        }
        return;
      }
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
