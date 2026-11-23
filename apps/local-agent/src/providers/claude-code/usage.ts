import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeUsage } from '@pocket-agent/protocol';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { helperSessionId } from './helper-sessions.js';
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
  const helper = helperSessionId();
  try {
    const q = query({
      prompt: never,
      options: {
        cwd,
        // A known id, so session discovery doesn't list this helper as a chat.
        sessionId: helper.id,
        persistSession: false,
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
    const account = await signIn(q);
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
      plan: account.plan,
      loginExpiresAt: account.loginExpiresAt,
      updatedAt: now().toISOString(),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    abort.abort();
    helper.release();
  }
}

/** "max" + "default_claude_max_5x" → "Max 5x"; "pro" → "Pro". */
export function planName(type: unknown, tier: unknown): string | null {
  if (typeof type !== 'string' || !type) return null;
  const name = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  const x = typeof tier === 'string' ? /_(\d+x)$/i.exec(tier)?.[1] : undefined;
  return (x ? `${name} ${x.toLowerCase()}` : name).slice(0, 40);
}

/**
 * The plan and when this PC's Claude sign-in ends. Only those two fields are read from Claude
 * Code's credentials file (never the tokens); where it keeps them elsewhere (the macOS keychain)
 * the plan comes from the SDK and the end date is unknown.
 */
async function signIn(q: Record<string, unknown>): Promise<{ plan: string | null; loginExpiresAt: string | null }> {
  let type: unknown;
  let tier: unknown;
  let end: unknown;
  try {
    const dir = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
    const oauth = (JSON.parse(readFileSync(path.join(dir, '.credentials.json'), 'utf8')) as {
      claudeAiOauth?: Record<string, unknown>;
    }).claudeAiOauth;
    type = oauth?.['subscriptionType'];
    tier = oauth?.['rateLimitTier'];
    end = oauth?.['refreshTokenExpiresAt'];
  } catch {
    /* not in a file on this PC */
  }
  if (typeof type !== 'string' && typeof q['accountInfo'] === 'function') {
    try {
      type = ((await (q['accountInfo'] as () => Promise<{ subscriptionType?: string }>).call(q)) ?? {})
        .subscriptionType;
    } catch {
      /* unknown */
    }
  }
  const at = typeof end === 'number' && Number.isFinite(end) ? new Date(end) : null;
  return {
    plan: planName(type, tier),
    loginExpiresAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
  };
}
