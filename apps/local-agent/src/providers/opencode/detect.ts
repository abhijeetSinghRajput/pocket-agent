import type { ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * OpenCode (the open-source coding agent): is it on this PC, usable, and with which models. Its
 * npm install puts a .cmd shim on PATH that only a shell runs, so the real program next to it is
 * used instead (and its own installer's folder, ~/.opencode/bin).
 */

const DETECT_TIMEOUT_MS = 60_000;

/** The `opencode` program: OPENCODE_PATH, its installer's folder, the npm package's, else PATH's. */
export function opencodeCommand(home = os.homedir(), pathEnv = process.env['PATH'] ?? ''): string {
  if (process.env['OPENCODE_PATH']) return process.env['OPENCODE_PATH'];
  const win = process.platform === 'win32';
  const exe = win ? 'opencode.exe' : 'opencode';
  const candidates = [path.join(home, '.opencode', 'bin', exe)];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, exe));
    // npm's shim folder: the package (and its real program) sits next to it.
    candidates.push(path.join(dir, 'node_modules', 'opencode-ai', 'bin', exe));
  }
  return candidates.find((c) => existsSync(c)) ?? 'opencode';
}

/**
 * OpenCode's model ids name their provider ("opencode/big-pickle"); the protocol's ids can't hold
 * "/", so they travel as "opencode::big-pickle" and are turned back for OpenCode.
 */
export const toAppModel = (id: string) => id.replaceAll('/', '::');
export const toOpencodeModel = (id: string) => id.replaceAll('::', '/');

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;

/** "opencode/big-pickle" → "Big Pickle (OpenCode)". */
function modelName(id: string): string {
  const [provider, ...rest] = id.split('/');
  const words = (rest.join('/') || provider || id).replace(/[-_]+/g, ' ').trim();
  const title = words.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return rest.length && provider ? `${title} (${provider === 'opencode' ? 'OpenCode' : provider})` : title;
}

/** `opencode models` prints one "<provider>/<model>" per line. */
export function parseModels(out: string): ModelOption[] {
  const models: ModelOption[] = [];
  for (const line of out.split(/\r?\n/)) {
    const id = line.trim();
    if (!id.includes('/') || /\s/.test(id)) continue;
    const appId = toAppModel(id);
    if (!MODEL_ID.test(appId) || appId.length > 100) continue;
    models.push({ id: appId, name: modelName(id).slice(0, 100), description: '' });
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
 * Null when OpenCode isn't installed. Usable ("signed in") when it lists models: its free models
 * need no account, others need a provider set up with `opencode auth login`.
 */
export async function detectOpencode(
  opts: { command?: string; run?: RunFn } = {},
): Promise<OtherAgent | null> {
  const command = opts.command ?? opencodeCommand();
  const exec = opts.run ?? run;
  const version = await exec(command, ['--version']);
  if (version.missing) return null;
  const listed = await exec(command, ['models']);
  const models = listed.ok ? parseModels(listed.stdout) : [];
  return {
    provider: 'opencode',
    version: /\d+\.\d+\.\d+[^\s]*/.exec(version.stdout)?.[0]?.slice(0, 40) ?? 'unknown',
    signedIn: models.length > 0,
    models,
  };
}
