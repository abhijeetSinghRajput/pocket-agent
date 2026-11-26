import type { ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { AppServerClient, type Transport } from './rpc.js';

type Json = Record<string, unknown>;

const DETECT_TIMEOUT_MS = 20_000;

/**
 * Is Codex on this PC, signed in, and with which models: asked of a short-lived `codex
 * app-server` (closed right after). Null when Codex isn't installed or doesn't answer. Pocket Agent
 * only learns whether it is signed in, never the account or its tokens.
 */
export async function detectCodex(
  connect: () => Transport,
  version: string,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
): Promise<OtherAgent | null> {
  let transport: Transport;
  try {
    transport = connect();
  } catch {
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
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DETECT_TIMEOUT_MS));
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
    return {
      provider: 'codex',
      version: codexVersion(init.userAgent),
      signedIn: !!account && account['account'] !== null && account['account'] !== undefined,
      models: (models?.data ?? []).flatMap(toModelOption).slice(0, 40),
    };
  })().catch(() => null);
  try {
    return await Promise.race([ask, timeout]);
  } finally {
    client.close();
  }
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
