import type { ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Google's Antigravity CLI (`agy`, the successor of Gemini CLI for Google accounts): is it on this
 * PC, signed in, and with which models. Its installer puts it in `~/.gemini/bin` (not always on
 * PATH), so that folder is looked in first.
 */

const DETECT_TIMEOUT_MS = 30_000;

/** The `agy` program: from the installer's folder, else whatever PATH finds. */
export function antigravityCommand(home = os.homedir()): string {
  const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const installed = path.join(home, '.gemini', 'bin', exe);
  return existsSync(installed) ? installed : 'agy';
}

/** The installer records the version next to the program (`agy.version.json`). */
export function antigravityVersion(command: string): string {
  try {
    const file = path.join(path.dirname(command), 'agy.version.json');
    const v = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && v ? v.slice(0, 40) : 'unknown';
  } catch {
    return 'unknown';
  }
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;

/** `agy models` prints "Fetching available models..." then one `<id>\t<name>` per line. */
export function parseModels(out: string): ModelOption[] {
  const models: ModelOption[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [id, ...rest] = line.split('\t');
    const name = rest.join(' ').trim();
    if (!id || !name || !MODEL_ID.test(id.trim()) || id.length > 100) continue;
    models.push({ id: id.trim(), name: name.slice(0, 100), description: '' });
  }
  return models.slice(0, 40);
}

export type RunFn = (
  command: string,
  args: string[],
) => Promise<{ ok: boolean; stdout: string; missing: boolean }>;

const run: RunFn = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: DETECT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        resolve({ ok: !err, stdout: String(stdout ?? ''), missing: code === 'ENOENT' });
      },
    );
  });

/**
 * Null when Antigravity isn't installed. Signed in when it can list its models (that needs the
 * account; Pocket Agent never sees the account or its tokens).
 */
export async function detectAntigravity(
  opts: { command?: string; run?: RunFn } = {},
): Promise<OtherAgent | null> {
  const command = opts.command ?? antigravityCommand();
  const res = await (opts.run ?? run)(command, ['models']);
  if (res.missing) return null;
  const models = res.ok ? parseModels(res.stdout) : [];
  return {
    provider: 'antigravity',
    version: antigravityVersion(command),
    signedIn: res.ok && models.length > 0,
    models,
  };
}
