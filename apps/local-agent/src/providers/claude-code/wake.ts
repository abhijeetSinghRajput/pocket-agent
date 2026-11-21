import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { filesDir, messageContent, type LocalFile } from '../../attachments.js';
import { APP_CONTEXT } from './app-context.js';
import type { TurnEffort, TurnMode } from '@pocket-agent/protocol';
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

interface Running {
  queue: Item[];
  abort: AbortController;
  /** Stopped from Pocket Agent (as opposed to the session ending). */
  interrupted: boolean;
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
  /** Sessions already told that the user is on the app. */
  private readonly briefed = new Set<string>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly query: QueryFn,
    private readonly ack: CommandAck,
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly approvals?: ManagedApprovalOptions,
  ) {}

  /** Called after each woken turn (the transcript reader skips what this turn already reported). */
  onTurnEnd: (sessionId: string) => void = () => undefined;

  isRunning = (sessionId: string): boolean => this.running.has(sessionId);

  /** Runs the instruction now (or right after the wake turn already running for this session). */
  run(sessionId: string, cwd: string, item: Item): void {
    const r = this.running.get(sessionId);
    if (r) {
      r.queue.push(item);
      this.ack(item.commandId, 'Accepted');
      return;
    }
    const fresh: Running = { queue: [item], abort: new AbortController(), interrupted: false };
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

  /** Stops the turn running for this session now, and drops what was queued behind it. */
  interrupt(sessionId: string): boolean {
    const r = this.running.get(sessionId);
    if (!r) return false;
    r.interrupted = true;
    r.abort.abort();
    return true;
  }

  onSessionEnd(sessionId: string): void {
    this.running.get(sessionId)?.abort.abort();
    this.missed.delete(sessionId);
    this.briefed.delete(sessionId);
  }

  stopAll(): void {
    for (const r of this.running.values()) r.abort.abort();
  }

  private async drain(sessionId: string, cwd: string, r: Running): Promise<void> {
    try {
      for (let item = r.queue.shift(); item; item = r.queue.shift()) {
        if (r.abort.signal.aborted) {
          this.ack(item.commandId, 'Failed', { error: r.interrupted ? 'interrupted' : 'session_ended' });
          continue;
        }
        if (item.expiresAt <= this.now()) {
          this.ack(item.commandId, 'Expired');
          continue;
        }
        await this.turn(sessionId, cwd, item, r);
      }
    } finally {
      this.running.delete(sessionId);
    }
  }

  private async turn(sessionId: string, cwd: string, item: Item, r: Running): Promise<void> {
    // The session was started in the editor, so its system prompt knows nothing about the app: the
    // first message we run in it says where the user is. Once per session is enough.
    const first = !this.briefed.has(sessionId);
    this.briefed.add(sessionId);
    const withContext = (content: ReturnType<typeof messageContent>) => {
      if (!first) return content;
      const note = {
        type: 'text',
        text: `<pocket-agent-context>\n${APP_CONTEXT}\n</pocket-agent-context>`,
      } as const;
      return typeof content === 'string'
        ? [note, { type: 'text', text: content } as const]
        : [note, ...content];
    };
    const abort = r.abort;
    this.ack(item.commandId, 'Executing');
    this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(item.text) });
    this.registry.setStatus(sessionId, 'Running', truncate(item.text.trim().split(/\r?\n/)[0] ?? '', 200));

    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content: withContext(messageContent(item.text, item.files)) },
        parent_tool_use_id: null,
      };
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
          permissionMode: item.permissionMode ?? 'default',
          abortController: abort,
          ...(item.model ? { model: item.model } : {}),
          ...(item.effort ? { effort: item.effort } : {}),
          // The folder this message's files were saved in: readable for this turn.
          ...(filesDir(item.files) ? { additionalDirectories: [filesDir(item.files)!] } : {}),
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
      error = r.interrupted ? 'interrupted' : abort.signal.aborted ? 'session_ended' : 'session_error';
      if (!abort.signal.aborted) {
        this.log('error', `waking session ${sessionId} failed: ${(err as Error).message}`);
        this.registry.event(sessionId, 'agent.error', { message: truncate((err as Error).message) });
      }
    }

    if (r.interrupted) {
      // Stopped from Pocket Agent, however the stream ended.
      outcome = 'Failed';
      error = 'interrupted';
    }
    this.onTurnEnd(sessionId);
    const list = this.missed.get(sessionId) ?? [];
    list.push({ prompt: truncate(item.text, 1000), reply: truncate(reply, 1500) });
    this.missed.set(sessionId, list.slice(-MAX_MISSED));
    if (r.interrupted) {
      this.registry.event(sessionId, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
      this.registry.setStatus(sessionId, 'WaitingForInput');
    } else if (!abort.signal.aborted) {
      this.registry.setStatus(sessionId, outcome === 'Completed' ? 'WaitingForInput' : 'Failed');
    }
    this.ack(item.commandId, outcome, outcome === 'Failed' ? { error } : {});
  }
}
