import { ModelOption } from '@pocket-agent/protocol';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from './managed.js';

/**
 * The models this PC's Claude Code offers, as Claude Code lists them itself (the same list its own
 * model picker shows). Asks a short-lived SDK session that is never sent a prompt, so nothing is
 * run and nothing is billed. Returns [] if it can't be read (the app then offers no model choice).
 */
export async function listModels(query: QueryFn, cwd: string, timeoutMs = 20_000): Promise<ModelOption[]> {
  const abort = new AbortController();
  // A prompt stream that never yields: the session initialises, then waits.
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
        // Not a session to report: the hook relay skips it.
        env: { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' },
      },
    });
    if (typeof q.supportedModels !== 'function') return [];
    const raw = await q.supportedModels();
    const out: ModelOption[] = [];
    for (const m of raw) {
      const parsed = ModelOption.safeParse({
        id: m.value,
        name: String(m.displayName ?? m.value).slice(0, 100),
        description: String(m.description ?? '').slice(0, 200),
      });
      if (parsed.success && !out.some((o) => o.id === parsed.data.id)) out.push(parsed.data);
    }
    return out.slice(0, 40);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
