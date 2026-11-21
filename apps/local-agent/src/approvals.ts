export type RemoteDecision =
  /** `answers`: the user's answers to Claude's question (used for AskUserQuestion only). */
  { behavior: 'allow'; answers?: Record<string, string> } | { behavior: 'deny'; message: string };

/**
 * The input AskUserQuestion runs with when the user answered in Pocket Agent: Claude's own questions,
 * unchanged, plus the answers. Returns undefined unless every answer belongs to a question Claude
 * asked — then nothing is added and the request is treated as a plain allow.
 */
export function answeredQuestionInput(
  toolName: string,
  toolInput: unknown,
  answers: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  if (toolName !== 'AskUserQuestion' || !answers) return undefined;
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<string, unknown>;
  const questions = Array.isArray(input['questions']) ? input['questions'] : [];
  const asked = questions
    .map((q) => (q && typeof q === 'object' ? (q as { question?: unknown }).question : undefined))
    .filter((q): q is string => typeof q === 'string');
  const entries = Object.entries(answers);
  const valid =
    entries.length > 0 &&
    entries.every(([q, a]) => asked.includes(q) && typeof a === 'string' && a.length > 0 && a.length <= 500);
  return valid ? { ...input, answers: Object.fromEntries(entries) } : undefined;
}

interface Pending {
  resolve: (d: RemoteDecision | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Permission requests the PC is holding for a decision from Pocket Agent. Each request resolves
 * exactly once: with the remote decision, or with `null` (timed out / cancelled / answered on the
 * PC) — and `null` always means "not approved by Pocket Agent".
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
   * A decision arrived from Pocket Agent. Returns false when nothing was waiting any more (too late) —
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
