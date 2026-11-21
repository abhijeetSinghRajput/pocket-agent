import { ClaudeUsage } from '@pocket-agent/protocol';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from './managed.js';

type Window = { utilization?: unknown; resets_at?: unknown } | null | undefined;

function window(w: Window): { percent: number; resetsAt: string | null } | null {
  if (!w || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
  const at = typeof w.resets_at === 'string' ? new Date(w.resets_at) : null;
  return {
    percent: Math.max(0, Math.min(1000, w.utilization)),
    resetsAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
  };
}

/**
 * The Claude plan usage of the account signed in on this PC: the numbers behind Claude Code's own
 * /usage (5-hour session, 7 days, per-model). Read from an SDK session that is never sent a prompt,
 * so nothing runs and nothing is billed. Returns null when it isn't available (API-key sign-in, an
 * older Claude Code): the SDK marks this API experimental, so anything unexpected is "not available".
 */
export async function readUsage(
  query: QueryFn,
  cwd: string,
  now: () => Date = () => new Date(),
  timeoutMs = 20_000,
): Promise<ClaudeUsage | null> {
  const abort = new AbortController();
  const never: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((r) =>
          abort.signal.addEventListener('abort', () => r({ done: true, value: undefined }), { once: true }),
        ),
    }),
  };
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const q = query({
      prompt: never,
      options: {
        cwd,
        abortController: abort,
        permissionMode: 'default',
        env: { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' },
      },
    }) as unknown as Record<string, unknown>;
    const read = q['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'];
    if (typeof read !== 'function') return null;
    const res = (await (read as (o: { skipBehaviors: boolean }) => Promise<unknown>).call(q, {
      skipBehaviors: true,
    })) as { rate_limits_available?: unknown; rate_limits?: Record<string, unknown> | null } | null;
    const limits = res?.rate_limits;
    if (!res?.rate_limits_available || !limits) return null;
    const scoped = Array.isArray(limits['model_scoped']) ? (limits['model_scoped'] as unknown[]) : [];
    const parsed = ClaudeUsage.safeParse({
      session: window(limits['five_hour'] as Window),
      weekly: window(limits['seven_day'] as Window),
      models: scoped
        .map((m) => {
          const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
          const w = window(o as Window);
          return w && typeof o['display_name'] === 'string' && o['display_name']
            ? { name: o['display_name'].slice(0, 60), ...w }
            : null;
        })
        .filter((m) => m !== null)
        .slice(0, 8),
      updatedAt: now().toISOString(),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
