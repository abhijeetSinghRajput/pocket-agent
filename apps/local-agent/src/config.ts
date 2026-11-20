import type { Platform } from '@pocket-agent/protocol';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** Non-secret local state. The device secret lives in the SecretStore, never here. */
export const AgentConfig = z.object({
  apiUrl: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  pairedAt: z.string(),
  revokedAt: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export async function loadConfig(home: string): Promise<AgentConfig | null> {
  const raw = await readFile(path.join(home, 'config.json'), 'utf8').catch(() => null);
  if (!raw) return null;
  const parsed = AgentConfig.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function saveConfig(home: string, config: AgentConfig): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export async function deleteConfig(home: string): Promise<void> {
  await rm(path.join(home, 'config.json'), { force: true });
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * TLS is required for every remote connection. Plain http is accepted only for loopback
 * (local development, where the API runs on the same machine).
 */
export function validateApiUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid API URL: ${input}`);
  }
  if (url.username || url.password) throw new Error('API URL must not contain credentials');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return url;
  throw new Error('API URL must use https:// (http:// is only allowed for localhost)');
}

export function wsUrlFor(apiUrl: string): string {
  const url = validateApiUrl(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/+$/, '') + '/ws/agent';
  url.search = '';
  return url.toString();
}

export function currentPlatform(p: NodeJS.Platform = process.platform): Platform {
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}
