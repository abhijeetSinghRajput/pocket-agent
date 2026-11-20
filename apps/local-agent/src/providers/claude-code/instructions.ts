import { truncate, type SessionRegistry } from '../../sessions/registry.js';

export type CommandAck = (
  commandId: string,
  status: 'Accepted' | 'Executing' | 'Completed' | 'Failed' | 'Expired',
  extra?: { error?: string; externalSessionId?: string },
) => void;

interface Item {
  commandId: string;
  text: string;
  expiresAt: number;
}

/** What Claude reads as the reason it should continue (Stop hook "block"). */
export function stopHookReason(text: string): string {
  return `New instruction from the user, sent remotely through AgentDock:\n\n${text}`;
}

/**
 * Instructions for sessions the user started themselves. Claude Code offers no supported way to
 * push a prompt into a running interactive session, so an instruction waits until Claude finishes
 * its current turn: the Stop hook then answers `{"decision":"block","reason":…}` and Claude
 * continues in the same session. An idle session receives it only after its next turn ends.
 */
export class ObservedInstructions {
  private readonly queues = new Map<string, Item[]>();
  /** Instruction delivered at the last Stop, completed by the next Stop. */
  private readonly inFlight = new Map<string, string>();

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

  pending(sessionId: string): number {
    return this.queues.get(sessionId)?.length ?? 0;
  }

  /** Called on every Stop hook. Returns the hook output to deliver the next instruction, if any. */
  onStop(sessionId: string): { decision: 'block'; reason: string } | undefined {
    const finished = this.inFlight.get(sessionId);
    if (finished) {
      this.inFlight.delete(sessionId);
      this.ack(finished, 'Completed');
    }
    this.expire(sessionId);
    const next = this.queues.get(sessionId)?.shift();
    if (!next) return undefined;
    this.inFlight.set(sessionId, next.commandId);
    this.ack(next.commandId, 'Executing');
    this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(next.text) });
    this.registry.setStatus(sessionId, 'Running', truncate(next.text.trim().split(/\r?\n/)[0] ?? '', 200));
    return { decision: 'block', reason: stopHookReason(next.text) };
  }

  onSessionEnd(sessionId: string): void {
    const inflight = this.inFlight.get(sessionId);
    if (inflight) this.ack(inflight, 'Failed', { error: 'session_ended' });
    for (const item of this.queues.get(sessionId) ?? [])
      this.ack(item.commandId, 'Failed', { error: 'session_ended' });
    this.inFlight.delete(sessionId);
    this.queues.delete(sessionId);
  }

  /** Drops instructions that waited too long (never delivered late). */
  expire(sessionId?: string): void {
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
