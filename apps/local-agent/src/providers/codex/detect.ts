import type { AgentAccount, ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { AppServerClient, type Transport } from './rpc.js';

type Json = Record<string, unknown>;

// Codex's first start on a PC can be slow (unpacking, a virus scan), so it gets a while.
const DETECT_TIMEOUT_MS = 45_000;

/**
 * Is Codex on this PC, signed in, with which account and which models: asked of a short-lived
 * `codex app-server` (closed right after). Null when Codex isn't installed or doesn't answer. The
 * account is what Codex itself reports (email and plan); its tokens are never seen.
 */
export async function detectCodex(
  connect: () => Transport,
  version: string,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
): Promise<OtherAgent | null> {
  let transport: Transport;
  try {
    transport = connect();
  } catch (err) {
    log('info', `Codex not found: ${(err as Error).message}`);
    return null;
  }
  const client = new AppServerClient(
    transport,
    {
      notification: () => undefined,
      request: () => Promise.reject(new Error('not now')),
      closed: () => undefined,
    },
    log,
  );
  // Why a check came back empty goes to the log: the app can only say "not installed".
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      log('warn', `Codex didn't answer within ${DETECT_TIMEOUT_MS / 1000} s`);
      resolve(null);
    }, DETECT_TIMEOUT_MS);
  });
  const ask = (async (): Promise<OtherAgent | null> => {
    const init = await client.request<{ userAgent?: string }>('initialize', {
      clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    client.notify('initialized');
    const [account, models] = await Promise.all([
      client.request<Json>('account/read', {}).catch(() => null),
      client.request<{ data?: Json[] }>('model/list', {}).catch(() => null),
    ]);
    const signedIn = !!account && account['account'] !== null && account['account'] !== undefined;
    return {
      provider: 'codex',
      version: codexVersion(init.userAgent),
      signedIn,
      models: (models?.data ?? []).flatMap(toModelOption).slice(0, 40),
      account: signedIn ? codexAccount(account['account']) : null,
    };
  })().catch((err: Error) => {
    log('warn', `Codex check failed: ${err.message}`);
    return null;
  });
  try {
    return await Promise.race([ask, timeout]);
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

/** Codex's account/read `account`: ChatGPT (email and plan), an API key, or another provider. */
export function codexAccount(a: unknown): AgentAccount | null {
  if (!a || typeof a !== 'object') return null;
  const acc = a as Json;
  if (acc['type'] === 'apiKey') return { email: null, plan: 'API key' };
  if (acc['type'] !== 'chatgpt') return null;
  const email = typeof acc['email'] === 'string' && acc['email'].length <= 254 ? acc['email'] : null;
  const raw = typeof acc['planType'] === 'string' ? acc['planType'] : '';
  const plan =
    raw && raw !== 'unknown' ? `ChatGPT ${raw[0]!.toUpperCase()}${raw.slice(1)}`.slice(0, 60) : 'ChatGPT';
  return { email, plan };
}

/** "pocket-agent/0.172.0 (Windows …)" → "0.172.0". */
export function codexVersion(userAgent: string | undefined): string {
  return /\/(\d+\.\d+\.\d+[^\s)]*)/.exec(userAgent ?? '')?.[1]?.slice(0, 40) ?? 'unknown';
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;

function toModelOption(m: Json): ModelOption[] {
  const id = String(m['id'] ?? m['model'] ?? '');
  if (m['hidden'] === true || !MODEL_ID.test(id) || id.length > 100) return [];
  return [
    {
      id,
      name: String(m['displayName'] ?? id).slice(0, 100),
      description: String(m['description'] ?? '').slice(0, 200),
    },
  ];
}
