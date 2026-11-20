import { CLAUDE_CODE_CAPABILITIES } from '@agentdock/protocol';
import type { CanUseTool, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { summarizeToolInput, summarizeToolOutput } from './summarize.js';

export type QueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

/** Message shown to Claude when a managed session asks for permission before M5. */
export const NO_APPROVAL_CHANNEL =
  'AgentDock denied this action: remote approval is not available yet, and AgentDock never approves ' +
  'actions on its own. Continue without it, or ask the user to run this step themselves.';

interface Managed {
  inbox: string[];
  wake: (() => void) | null;
  closed: boolean;
  abort: AbortController;
  toolNames: Map<string, string>;
}

/**
 * Sessions AgentDock starts itself with the Claude Agent SDK: full control (instructions at any
 * time, interrupt), and their events come from the SDK stream rather than hooks.
 * Claude Code's own settings (user/project/local) still apply — permission rules included.
 */
export class ManagedSessions {
  private readonly sessions = new Map<string, Managed>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
  ) {}

  isManaged = (id: string) => this.sessions.has(id);

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  async start(input: { projectPath: string; prompt: string; model?: string }): Promise<string> {
    const projectPath = path.resolve(input.projectPath);
    const st = await stat(projectPath).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a directory: ${projectPath}`);

    // We choose the id up front so hooks and discovery recognise it as managed immediately.
    const id = randomUUID();
    const m: Managed = {
      inbox: [],
      wake: null,
      closed: false,
      abort: new AbortController(),
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

    const q = this.query({
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

    this.send(id, input.prompt);
    void this.consume(id, m, q);
    return id;
  }

  /** Queues an instruction; it is delivered as the session's next user message. */
  send(id: string, text: string): boolean {
    const m = this.sessions.get(id);
    if (!m || m.closed) return false;
    m.inbox.push(text);
    this.registry.event(id, 'agent.output', { role: 'user', text: truncate(text) });
    this.registry.setStatus(id, 'Running', truncate(text.trim().split(/\r?\n/)[0] ?? '', 200));
    m.wake?.();
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

  private async *messages(_id: string, m: Managed): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (!m.inbox.length && !m.closed) await new Promise<void>((r) => (m.wake = r));
      if (m.closed) return;
      const text = m.inbox.shift()!;
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    }
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
        if (msg.subtype === 'success') this.registry.setStatus(id, 'WaitingForInput');
        else {
          this.registry.event(id, 'agent.error', { message: `Turn ended: ${msg.subtype}` });
          this.registry.setStatus(id, 'Failed');
        }
        return;
      default:
    }
  }
}
