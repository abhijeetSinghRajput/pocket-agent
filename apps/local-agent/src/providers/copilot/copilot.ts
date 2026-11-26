import type { OtherAgent } from '@pocket-agent/protocol';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AcpSessions, type AcpProfile } from '../antigravity/sessions.js';
import { AppServerClient, spawnLines, type Transport } from '../codex/rpc.js';

/**
 * GitHub Copilot CLI, run for Pocket Agent over ACP (`copilot --acp`), like Antigravity and
 * OpenCode. Its npm install puts a shim on PATH that only a shell runs on Windows, so the real
 * program inside the package is used.
 */

/** The `copilot` program: COPILOT_PATH, the npm package's own binary, else whatever PATH finds. */
export function copilotCommand(pathEnv = process.env['PATH'] ?? ''): string {
  if (process.env['COPILOT_PATH']) return process.env['COPILOT_PATH'];
  const win = process.platform === 'win32';
  const exe = win ? 'copilot.exe' : 'copilot';
  const platformPackage = `copilot-${process.platform}-${process.arch}`;
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const modules of [path.join(dir, 'node_modules'), path.join(dir, '..', 'lib', 'node_modules')]) {
      const real = path.join(modules, '@github', 'copilot', 'node_modules', '@github', platformPackage, exe);
      if (existsSync(real)) return real;
    }
    if (existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return 'copilot';
}

const MODE = 'https://agentclientprotocol.com/protocol/session-modes#';

/**
 * Copilot's own settings for the app's modes: Manual asks before commands and changes, Auto lets
 * Copilot's own review pass what it judges safe (it still asks for the rest), Plan plans. Its
 * "Allow all" and Autopilot are never set from here.
 */
export const COPILOT_PROFILE: AcpProfile = {
  provider: 'copilot',
  name: 'Copilot',
  // Copilot reopens a chat by loading it (it has no resume without replay).
  resume: 'load',
  mode: (sessionId, mode) =>
    mode === 'plan'
      ? [{ method: 'session/set_mode', params: { sessionId, modeId: `${MODE}plan` } }]
      : [
          { method: 'session/set_mode', params: { sessionId, modeId: `${MODE}agent` } },
          {
            method: 'session/set_config_option',
            params: { sessionId, configId: 'allow_all', value: mode === 'auto' ? 'auto' : 'off' },
          },
        ],
};

/** Starts `copilot --acp` (the real program: no shell). */
export function spawnCopilotAcp(): Transport {
  return spawnLines(copilotCommand(), ['--acp'], false);
}

export class CopilotSessions extends AcpSessions {}

const DETECT_TIMEOUT_MS = 30_000;

type RunFn = (command: string, args: string[]) => Promise<{ stdout: string; missing: boolean }>;

const run: RunFn = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: DETECT_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      resolve({
        stdout: String(stdout ?? ''),
        missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT',
      });
    });
  });

/**
 * Null when Copilot CLI isn't installed. Signed in when it answers a request that needs the
 * account (listing its sessions; none is created). It has no model list to offer: chats use the
 * model Copilot is set to.
 */
export async function detectCopilot(
  opts: { command?: string; run?: RunFn; connect?: () => Transport } = {},
): Promise<OtherAgent | null> {
  const command = opts.command ?? copilotCommand();
  const version = await (opts.run ?? run)(command, ['--version']);
  if (version.missing) return null;
  let signedIn: boolean;
  let client: AppServerClient | undefined;
  try {
    client = new AppServerClient(
      (opts.connect ?? (() => spawnLines(command, ['--acp'], false)))(),
      {
        notification: () => undefined,
        request: () => Promise.reject(new Error('not now')),
        closed: () => undefined,
      },
      () => undefined,
      { name: 'copilot --acp', jsonrpc: true },
    );
    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version: '0' },
      },
      DETECT_TIMEOUT_MS,
    );
    await client.request('session/list', {}, DETECT_TIMEOUT_MS);
    signedIn = true;
  } catch {
    signedIn = false;
  } finally {
    client?.close();
  }
  return {
    provider: 'copilot',
    version: /\d+\.\d+\.\d+/.exec(version.stdout)?.[0] ?? 'unknown',
    signedIn,
    models: [],
  };
}
