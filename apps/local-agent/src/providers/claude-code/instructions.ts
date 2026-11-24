import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { APP_NOTE } from './app-context.js';

export type CommandAck = (
  commandId: string,
  status: 'Accepted' | 'Executing' | 'Completed' | 'Failed' | 'Expired',
  extra?: { error?: string; externalSessionId?: string },
) => void;

interface Item {
  commandId: string;
  /** What the user wrote (shown in the chat). */
  text: string;
  /** What Claude reads, when it differs (the text plus where attached files were saved). */
  deliver?: string;
  expiresAt: number;
}

/** What Claude reads as the reason it should continue (Stop hook "block"). */
export function stopHookReason(text: string): string {
  return `New instruction from the user, sent remotely through Pocket Agent. ${APP_NOTE}\n\n${text}`;
}

/** What Claude reads when a message arrives while it is working (PostToolUse `additionalContext`). */
export function midTurnContext(texts: string[]): string {
  const body = texts.length === 1 ? texts[0]! : texts.map((t, i) => `${i + 1}. ${t}`).join('\n\n');
  return (
    'New message from the user, sent remotely through Pocket Agent while you were working. ' +
    `Take it into account now, as you would a message typed in this window. ${APP_NOTE}\n\n${body}`
  );
}

/**
 * Instructions for sessions the user started themselves. Claude Code offers no supported way to
 * push a prompt into a running interactive session, so hooks carry it (verified with Claude Code):
 * - while Claude is working, at its next tool step: PostToolUse answers with `additionalContext`,
 *   and Claude reads the message in the same turn (like a message typed while it works);
 * - otherwise when the turn ends: Stop answers `{"decision":"block","reason":…}` and Claude continues.
 * An idle session receives it only after its next turn (or at once with `instructions wake`).
 */
export class ObservedInstructions {
  private readonly queues = new Map<string, Item[]>();
  /** Sessions asked to stop from Pocket Agent: the interrupt command, applied at the next hook. */
  private readonly stops = new Map<string, { commandId: string; expiresAt: number }>();
  /** Instructions delivered and being worked on; completed by the next Stop. */
  private readonly inFlight = new Map<string, string[]>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly ack: CommandAck,
    private readonly now: () => number = Date.now,
  ) {}

  enqueue(sessionId: string, item: Item): void {
    const q = this.queues.get(sessionId) ?? [];
    q.push(item);
    this.queues.set(sessionId, q);
    this.ack(item.commandId, 'Accepted');
  }

  /** Stop Claude at its next step (the next tool hook). */
  requestStop(sessionId: string, commandId: string, expiresAt: number): void {
    const earlier = this.stops.get(sessionId);
    if (earlier) this.ack(earlier.commandId, 'Completed'); // one stop is enough
    this.stops.set(sessionId, { commandId, expiresAt });
    this.ack(commandId, 'Accepted');
  }

  /**
   * Called at each tool hook. True if Claude must stop now: the interrupt is done, and whatever
   * instruction it was working on ends with it.
   */
  takeStop(sessionId: string): boolean {
    const stop = this.stops.get(sessionId);
    if (!stop) return false;
    this.stops.delete(sessionId);
    if (stop.expiresAt <= this.now()) {
      this.ack(stop.commandId, 'Expired');
      return false;
    }
    for (const id of this.inFlight.get(sessionId) ?? []) this.ack(id, 'Failed', { error: 'interrupted' });
    this.inFlight.delete(sessionId);
    this.ack(stop.commandId, 'Completed');
    return true;
  }

  /** The turn ended by itself before the stop was applied: nothing left to stop. */
  private clearStop(sessionId: string): void {
    const stop = this.stops.get(sessionId);
    if (!stop) return;
    this.stops.delete(sessionId);
    this.ack(stop.commandId, 'Completed');
  }

  /**
   * Takes back a message Claude hasn't started on (to be edited in the app): it leaves the queue
   * and is reported Failed ("withdrawn"). False when it isn't waiting here.
   */
  withdraw(commandId: string): boolean {
    for (const q of this.queues.values()) {
      const i = q.findIndex((item) => item.commandId === commandId);
      if (i < 0) continue;
      q.splice(i, 1);
      this.ack(commandId, 'Failed', { error: 'withdrawn' });
      return true;
    }
    return false;
  }

  pending(sessionId: string): number {
    return this.queues.get(sessionId)?.length ?? 0;
  }

  /**
   * Called after each tool call of the main conversation. Hands every waiting instruction to Claude
   * now, in the turn it is working on. Returns the context to add, if any.
   */
  onToolDone(sessionId: string): string | undefined {
    this.expire(sessionId);
    const q = this.queues.get(sessionId);
    if (!q?.length) return undefined;
    this.queues.set(sessionId, []);
    const flying = this.inFlight.get(sessionId) ?? [];
    for (const item of q) {
      flying.push(item.commandId);
      this.ack(item.commandId, 'Executing');
      this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(item.text) });
    }
    this.inFlight.set(sessionId, flying);
    return midTurnContext(q.map((i) => i.deliver ?? i.text));
  }

  /** Called on every Stop hook. Returns the hook output to deliver the next instruction, if any. */
  onStop(sessionId: string): { decision: 'block'; reason: string } | undefined {
    this.clearStop(sessionId);
    const finished = this.inFlight.get(sessionId);
    if (finished) {
      this.inFlight.delete(sessionId);
      for (const id of finished) this.ack(id, 'Completed');
    }
    this.expire(sessionId);
    const next = this.queues.get(sessionId)?.shift();
    if (!next) return undefined;
    this.inFlight.set(sessionId, [next.commandId]);
    this.ack(next.commandId, 'Executing');
    this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(next.text) });
    this.registry.setStatus(sessionId, 'Running', truncate(next.text.trim().split(/\r?\n/)[0] ?? '', 200));
    return { decision: 'block', reason: stopHookReason(next.deliver ?? next.text) };
  }

  onSessionEnd(sessionId: string): void {
    this.clearStop(sessionId);
    for (const id of this.inFlight.get(sessionId) ?? []) this.ack(id, 'Failed', { error: 'session_ended' });
    for (const item of this.queues.get(sessionId) ?? [])
      this.ack(item.commandId, 'Failed', { error: 'session_ended' });
    this.inFlight.delete(sessionId);
    this.queues.delete(sessionId);
  }

  /** Drops instructions that waited too long (never delivered late). */
  expire(sessionId?: string): void {
    for (const [id, stop] of this.stops) {
      if ((!sessionId || id === sessionId) && stop.expiresAt <= this.now()) {
        this.stops.delete(id);
        this.ack(stop.commandId, 'Expired');
      }
    }
    const ids = sessionId ? [sessionId] : [...this.queues.keys()];
    for (const id of ids) {
      const q = this.queues.get(id);
      if (!q) continue;
      const keep = q.filter((i) => i.expiresAt > this.now());
      for (const dropped of q.filter((i) => i.expiresAt <= this.now()))
        this.ack(dropped.commandId, 'Expired');
      this.queues.set(id, keep);
    }
  }
}
