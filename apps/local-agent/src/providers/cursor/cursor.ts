import type { ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcpSessions, type AcpProfile } from '../antigravity/sessions.js';
import { AppServerClient, spawnLines, type Transport } from '../codex/rpc.js';

/**
 * Cursor's CLI agent, run for Pocket Agent over ACP (`agent acp`), like Antigravity, OpenCode and
 * Copilot. Its installer keeps each version in its own folder with its own Node; the newest is run
 * directly (its PATH shims are PowerShell scripts that would need a shell).
 */

/** The newest installed version: its node.exe and index.js (null when Cursor CLI isn't installed). */
export function cursorProgram(
  home = os.homedir(),
  localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'),
): { node: string; entry: string } | null {
  const roots = [path.join(localAppData, 'cursor-agent'), path.join(home, '.local', 'share', 'cursor-agent')];
  for (const root of roots) {
    const versions = path.join(root, 'versions');
    let names: string[];
    try {
      names = readdirSync(versions, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{4}\.\d+\.\d+/.test(d.name))
        .map((d) => d.name);
    } catch {
      continue;
    }
    // "2026.11.22-e9042b2": newest date first.
    names.sort((a, b) => dateOf(b) - dateOf(a));
    for (const name of names) {
      const dir = path.join(versions, name);
      const node = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
      const entry = path.join(dir, 'index.js');
      if (existsSync(node) && existsSync(entry)) return { node, entry };
    }
  }
  return null;
}

const dateOf = (version: string) => {
  const [y = '0', m = '0', d = '0'] = version.split('-')[0]!.split('.');
  return Number(y) * 10_000 + Number(m) * 100 + Number(d);
};

/**
 * Cursor's own modes: Agent (its default, as its permission settings allow) and Plan (read-only).
 * Its "Run everything" (--force) is never used.
 */
export const CURSOR_PROFILE: AcpProfile = {
  provider: 'cursor',
  name: 'Cursor',
  // Cursor reopens a chat by loading it (the history it replays is dropped: the phone has it).
  resume: 'load',
  mode: (sessionId, mode) => [
    { method: 'session/set_mode', params: { sessionId, modeId: mode === 'plan' ? 'plan' : 'agent' } },
  ],
  toAgentModel: cursorAgentModel,
  toAppModel: cursorAppModel,
};

/**
 * Cursor's own model ids carry their settings ("composer-2.5[fast=true]", "default[]" for Auto),
 * which the protocol's ids can't hold. The app uses the name before "[" ("composer-2.5", "auto");
 * the chat's own list of Cursor ids turns it back.
 */
export function cursorAppModel(id: string): string {
  const base = id.split('[')[0] ?? id;
  return base === 'default' ? 'auto' : base;
}

export function cursorAgentModel(id: string, available: string[] = []): string {
  return available.find((m) => cursorAppModel(m) === id) ?? (id === 'auto' ? 'default[]' : id);
}

/** Starts `agent acp` with the newest installed Cursor CLI (no shell). */
export function spawnCursorAcp(): Transport {
  const program = cursorProgram();
  if (!program) throw new Error('Cursor CLI is not installed on this PC');
  // Cursor writes its hook runners in PowerShell on Windows, but runs them with bash when the
  // environment says Git Bash (SHELL, MSYSTEM): every hook then fails and blocks each command and edit.
  return spawnLines(
    program.node,
    [program.entry, 'acp'],
    false,
    process.platform === 'win32' ? ['SHELL', 'MSYSTEM'] : [],
  );
}

export class CursorSessions extends AcpSessions {}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;

type RunFn = (command: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;

const run: RunFn = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      resolve({ ok: !err, stdout: String(stdout ?? '') }),
    );
  });

/**
 * Null when Cursor CLI isn't installed. Signed in when `agent status` says so; its models then come
 * from `agent models` (they depend on the account). The account is the email `status` prints.
 */
export async function detectCursor(
  opts: {
    program?: { node: string; entry: string } | null;
    run?: RunFn;
    listModels?: (program: { node: string; entry: string }) => Promise<ModelOption[]>;
  } = {},
): Promise<OtherAgent | null> {
  const program = opts.program === undefined ? cursorProgram() : opts.program;
  if (!program) return null;
  const exec = opts.run ?? run;
  const [version, status] = await Promise.all([
    exec(program.node, [program.entry, '--version']),
    exec(program.node, [program.entry, 'status']),
  ]);
  const signedIn = status.ok && /logged in/i.test(status.stdout) && !/not logged in/i.test(status.stdout);
  const models = signedIn ? await (opts.listModels ?? listCursorModels)(program) : [];
  // "✓ Logged in as you@example.com": the email Cursor itself prints.
  const email = signedIn ? /logged in as\s+(\S+@\S+)/i.exec(status.stdout)?.[1]?.slice(0, 254) : undefined;
  return {
    account: email ? { email, plan: null } : null,
    provider: 'cursor',
    version: /\d{4}\.\d+\.\d+[^\s]*/.exec(version.stdout)?.[0]?.slice(0, 40) ?? 'unknown',
    signedIn,
    models,
  };
}

/**
 * The models Cursor offers over ACP (the ids its chats take, which its `models` command doesn't
 * print), asked of a short-lived `agent acp` in an empty folder.
 */
export async function listCursorModels(program: { node: string; entry: string }): Promise<ModelOption[]> {
  const client = new AppServerClient(
    spawnLines(program.node, [program.entry, 'acp'], false),
    {
      notification: () => undefined,
      request: () => Promise.reject(new Error('not now')),
      closed: () => undefined,
    },
    () => undefined,
    { name: 'agent acp', jsonrpc: true },
  );
  try {
    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version: '0' },
      },
      30_000,
    );
    const res = await client.request<{ models?: { availableModels?: Array<Record<string, unknown>> } }>(
      'session/new',
      { cwd: os.tmpdir(), mcpServers: [] },
      30_000,
    );
    const seen = new Set<string>();
    return (res.models?.availableModels ?? [])
      .flatMap((m) => {
        const raw = typeof m['modelId'] === 'string' ? m['modelId'] : '';
        const id = cursorAppModel(raw);
        if (!raw || seen.has(id) || !MODEL_ID.test(id) || id.length > 100) return [];
        seen.add(id);
        const name = id === 'auto' ? 'Auto' : typeof m['name'] === 'string' ? m['name'] : id;
        return [{ id, name: name.slice(0, 100), description: '' }];
      })
      .slice(0, 40);
  } catch {
    return [];
  } finally {
    client.close();
  }
}
