import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import type { CommandAck } from './instructions.js';
import { approvalGate, reportSdkMessage, type ManagedApprovalOptions, type QueryFn } from './managed.js';

interface Item {
  commandId: string;
  text: string;
  expiresAt: number;
}

interface Running {
  queue: Item[];
  abort: AbortController;
}

/** One exchange that happened outside the PC's own Claude Code window. */
interface Missed {
  prompt: string;
  reply: string;
}

const MAX_MISSED = 5;

/**
 * Wakes an idle session the user started themselves (VS Code, terminal) when an instruction
 * arrives from Pocket Agent. Claude Code can't take a prompt into an idle interactive session, so
 * the Local Agent resumes the same session through the Claude Agent SDK and runs one turn per
 * instruction (verified: same session id, full history). Opt-in on the PC (`instructions wake enable`).
 *
 * Caveat, handled here: the editor keeps its own copy of the conversation in memory, so it doesn't
 * see these turns. While one runs, a prompt typed on the PC is held back (`blockPrompt`), and the
 * next prompt typed on the PC gets a summary of what was done meanwhile (`catchUp`).
 */
export class IdleWake {
  private readonly running = new Map<string, Running>();
  private readonly missed = new Map<string, Missed[]>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly ack: CommandAck,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
  ) {}

  isRunning = (sessionId: string): boolean => this.running.has(sessionId);

  /** Runs the instruction now (or right after the wake turn already running for this session). */
  run(sessionId: string, cwd: string, item: Item): void {
    const r = this.running.get(sessionId);
    if (r) {
      r.queue.push(item);
      this.ack(item.commandId, 'Accepted');
      return;
    }
    const fresh: Running = { queue: [item], abort: new AbortController() };
    this.running.set(sessionId, fresh);
    void this.drain(sessionId, cwd, fresh);
  }

  /** Message for a prompt typed on the PC while a wake turn is running, or undefined to let it through. */
  blockPrompt(sessionId: string): string | undefined {
    if (!this.running.has(sessionId)) return undefined;
    return 'Claude is still working on a message sent from Pocket Agent in this session. Send your prompt again once it has finished (you can follow it in Pocket Agent).';
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

  onSessionEnd(sessionId: string): void {
    this.running.get(sessionId)?.abort.abort();
    this.missed.delete(sessionId);
  }

  stopAll(): void {
    for (const r of this.running.values()) r.abort.abort();
  }

  private async drain(sessionId: string, cwd: string, r: Running): Promise<void> {
    try {
      for (let item = r.queue.shift(); item; item = r.queue.shift()) {
        if (r.abort.signal.aborted) {
          this.ack(item.commandId, 'Failed', { error: 'session_ended' });
          continue;
        }
        if (item.expiresAt <= this.now()) {
          this.ack(item.commandId, 'Expired');
          continue;
        }
        await this.turn(sessionId, cwd, item, r.abort);
      }
    } finally {
      this.running.delete(sessionId);
    }
  }

  private async turn(sessionId: string, cwd: string, item: Item, abort: AbortController): Promise<void> {
    this.ack(item.commandId, 'Executing');
    this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(item.text) });
    this.registry.setStatus(sessionId, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));

    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield { type: 'user', message: { role: 'user', content: item.text }, parent_tool_use_id: null };
    }
    const toolNames = new Map<string, string>();
    let reply = '';
    let outcome: 'Completed' | 'Failed' = 'Failed';
    let error = 'session_error';
    try {
      const q = this.query({
        prompt: prompt(),
        options: {
          cwd,
          resume: sessionId, // same session id, full history
          canUseTool: approvalGate(this.registry, sessionId, this.approvals, this.now),
          permissionMode: 'default',
          abortController: abort,
          // Its hooks would report this turn a second time; the SDK stream already does.
          env: { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' },
        },
      });
      for await (const msg of q) {
        reportSdkMessage(this.registry, sessionId, toolNames, msg);
        if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'text' && b.text.trim()) reply = b.text;
        }
        if (msg.type === 'result') {
          if (msg.subtype === 'success') outcome = 'Completed';
          else {
            error = msg.subtype;
            this.registry.event(sessionId, 'agent.error', { message: `Turn ended: ${msg.subtype}` });
          }
          break; // one turn per instruction
        }
      }
    } catch (err) {
      error = abort.signal.aborted ? 'session_ended' : 'session_error';
      if (!abort.signal.aborted) {
        this.log('error', `waking session ${sessionId} failed: ${(err as Error).message}`);
        this.registry.event(sessionId, 'agent.error', { message: truncate((err as Error).message) });
      }
    }

    const list = this.missed.get(sessionId) ?? [];
    list.push({ prompt: truncate(item.text, 1000), reply: truncate(reply, 1500) });
    this.missed.set(sessionId, list.slice(-MAX_MISSED));
    if (!abort.signal.aborted)
      this.registry.setStatus(sessionId, outcome === 'Completed' ? 'WaitingForInput' : 'Failed');
    this.ack(item.commandId, outcome, outcome === 'Failed' ? { error } : {});
  }
}
