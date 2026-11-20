/**
 * At-least-once delivery for session events. Events stay queued until the API acknowledges them
 * (after it has stored them) and are re-sent in order after every reconnect; the API deduplicates
 * by eventId, so replays are harmless.
 *
 * In memory only: if the agent process itself restarts, unacknowledged events are lost, and the
 * post-connect snapshot brings session states back in line.
 */
export class Outbox<T extends { eventId: string }> {
  private readonly queue = new Map<string, T>();
  dropped = 0;

  constructor(private readonly max = 10_000) {}

  push(event: T): void {
    this.queue.set(event.eventId, event);
    while (this.queue.size > this.max) {
      // Bounded memory while offline for a long time: drop the oldest events.
      const oldest = this.queue.keys().next().value!;
      this.queue.delete(oldest);
      this.dropped++;
    }
  }

  ack(eventId: string): void {
    this.queue.delete(eventId);
  }

  /** Unacknowledged events, oldest first. */
  pending(): T[] {
    return [...this.queue.values()];
  }

  get size(): number {
    return this.queue.size;
  }
}
