export type RemoteDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

interface Pending {
  resolve: (d: RemoteDecision | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Permission requests the PC is holding for a decision from AgentDock. Each request resolves
 * exactly once: with the remote decision, or with `null` (timed out / cancelled / answered on the
 * PC) — and `null` always means "not approved by AgentDock".
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();

  /** Waits for a decision on `requestId`, at most `waitMs`. */
  wait(requestId: string, waitMs: number): Promise<RemoteDecision | null> {
    this.cancel(requestId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(requestId, null), waitMs);
      this.pending.set(requestId, { resolve, timer });
    });
  }

  isWaiting(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * A decision arrived from AgentDock. Returns false when nothing was waiting any more (too late) —
   * the caller reports that as "stale" so the backend never records it as applied.
   */
  decide(requestId: string, decision: RemoteDecision): boolean {
    return this.settle(requestId, decision);
  }

  /** Stop waiting (answered on the PC, session ended, interrupted). */
  cancel(requestId: string): void {
    this.settle(requestId, null);
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.cancel(id);
  }

  private settle(requestId: string, decision: RemoteDecision | null): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    this.pending.delete(requestId);
    clearTimeout(p.timer);
    p.resolve(decision);
    return true;
  }
}
