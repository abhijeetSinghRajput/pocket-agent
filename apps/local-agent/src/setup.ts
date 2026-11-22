import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  autostartCommand,
  autostartCommandRegistered,
  autostartSupported,
  enableAutostart,
} from './autostart.js';
import {
  isEphemeralInstall,
  logFile,
  runningPid,
  spawnBackground,
  stopRunning,
  writePidFile,
} from './background.js';
import { loadConfig, validateApiUrl } from './config.js';
import { requestJson } from './http.js';
import { callLocalAgent } from './local-client.js';
import { loadPolicy } from './policy.js';
import {
  claudeConfigDir,
  defaultSettingsPath,
  hooksUpToDate,
  installHooks,
  relayCommand,
} from './providers/claude-code/install.js';
import { createSecretStore } from './secret-store.js';

/**
 * The pieces `pocket-agent connect` sets up, and `doctor` checks, kept separate:
 *   environment · pairing (backend auth) · integration (Claude Code hooks) · service (background
 *   process + start at sign-in) · workspace (folder authorization).
 * Every `ensure*` step is idempotent: it does nothing when that piece is already in place.
 */
export interface SetupContext {
  home: string;
  /** The installed cli.js (hooks and auto-start point at it). */
  cliPath: string;
  relayPath: string;
  nodePath: string;
  /** This CLI's version: a running agent of another version is restarted by `connect`. */
  version: string;
}

export const MIN_NODE = [24, 7] as const;

// ── Environment ─────────────────────────────────────────────────────────────

export function nodeSupported(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Claude Code is there when its config folder exists or `claude` is on PATH. */
export function claudeCodeDetected(env: NodeJS.ProcessEnv = process.env): boolean {
  if (existsSync(claudeConfigDir(env))) return true;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((d) => exts.some((x) => existsSync(path.join(d, `claude${x}`))));
}

export const stableInstall = (ctx: SetupContext) => !isEphemeralInstall(ctx.cliPath);

export type Reachability = { ok: true; ms: number } | { ok: false; reason: string };

/** Can this PC reach the Pocket Agent API? (A sleeping free-tier server can take ~30 s to wake.) */
export async function checkApi(apiUrl: string, timeoutMs = 45_000): Promise<Reachability> {
  let url: URL;
  try {
    url = new URL('/health/live', validateApiUrl(apiUrl));
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const t0 = Date.now();
  try {
    const r = await requestJson(url, { method: 'GET', timeoutMs });
    if (r.status >= 200 && r.status < 300) return { ok: true, ms: Date.now() - t0 };
    return { ok: false, reason: `the server answered HTTP ${r.status}` };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, reason: msg === 'timeout' ? 'no answer (timed out)' : `cannot reach ${url.origin}` };
  }
}

// ── Pairing ─────────────────────────────────────────────────────────────────

export type PairingState =
  | { kind: 'paired'; deviceName: string; apiUrl: string }
  | { kind: 'not-paired' }
  | { kind: 'revoked'; apiUrl: string }
  | { kind: 'no-secret'; apiUrl: string };

export async function pairingState(home: string): Promise<PairingState> {
  const config = await loadConfig(home);
  if (!config) return { kind: 'not-paired' };
  if (config.revokedAt) return { kind: 'revoked', apiUrl: config.apiUrl };
  if (!(await createSecretStore(home).load())) return { kind: 'no-secret', apiUrl: config.apiUrl };
  return { kind: 'paired', deviceName: config.deviceName, apiUrl: config.apiUrl };
}

// ── Integration: Claude Code hooks ─────────────────────────────────────────

export type HooksResult = { changed: false } | { changed: true; backupPath: string | null };

export function hookCommand(ctx: SetupContext): string {
  return relayCommand(ctx.nodePath, ctx.relayPath, ctx.home);
}

export async function hooksCurrent(ctx: SetupContext, settings = defaultSettingsPath()): Promise<boolean> {
  return hooksUpToDate(settings, hookCommand(ctx));
}

export async function ensureHooks(ctx: SetupContext, settings = defaultSettingsPath()): Promise<HooksResult> {
  if (!existsSync(ctx.relayPath))
    throw new Error(`Hook relay not found at ${ctx.relayPath}. Build the agent first.`);
  if (await hooksCurrent(ctx, settings)) return { changed: false };
  const r = await installHooks(settings, hookCommand(ctx));
  return { changed: true, backupPath: r.backupPath };
}

// ── Service: background process and start at sign-in ──────────────────────

export type AutostartResult = 'unchanged' | 'enabled' | 'unsupported';

export async function autostartCurrent(ctx: SetupContext): Promise<boolean> {
  return (await autostartCommandRegistered()) === autostartCommand(ctx.nodePath, ctx.cliPath);
}

export async function ensureAutostart(ctx: SetupContext): Promise<AutostartResult> {
  if (!autostartSupported()) return 'unsupported';
  if (await autostartCurrent(ctx)) return 'unchanged';
  await enableAutostart(autostartCommand(ctx.nodePath, ctx.cliPath));
  return 'enabled';
}

export type RunResult = { state: 'already' | 'started' | 'restarted'; pid: number };

/**
 * Starts the agent in the background. A running one is kept unless `restart` (e.g. after
 * re-pairing) or it is another version than this CLI (e.g. after an update).
 */
export async function ensureRunning(ctx: SetupContext, restart = false): Promise<RunResult> {
  const pid = await runningPid(ctx.home);
  if (pid && !restart && (await liveStatus(ctx.home))?.version === ctx.version)
    return { state: 'already', pid };
  const stopped = pid ? await stopRunning(ctx.home) : false;
  const child = spawnBackground(ctx.home, ctx.cliPath, ctx.nodePath);
  // Record it now, so `status`/`stop` see it before the child has finished starting.
  await writePidFile(ctx.home, child);
  return { state: stopped ? 'restarted' : 'started', pid: child };
}

/** `version: null`: an agent from before 0.1.4 (no /status), which can't tell whether it is online. */
export type LiveStatus = { connected: boolean; version: string | null };

/** Asks the running agent whether it is connected to the server; null if it doesn't answer. */
export async function liveStatus(home: string): Promise<LiveStatus | null> {
  try {
    const r = await callLocalAgent(home, 'GET', '/status');
    if (r.status === 404) return { connected: false, version: null };
    return r.status === 200 ? (r.body as LiveStatus) : null;
  } catch {
    return null;
  }
}

export type OnlineResult = { ok: true } | { ok: false; reason: 'exited' | 'timeout'; logTail: string[] };

/** Waits until the background agent reports a live connection to the server. */
export async function waitOnline(home: string, timeoutMs = 60_000): Promise<OnlineResult> {
  const deadline = Date.now() + timeoutMs;
  // Give a freshly spawned process a moment to write its PID file / endpoint.
  let missing = 0;
  while (Date.now() < deadline) {
    const live = await liveStatus(home);
    if (live?.connected) return { ok: true };
    if (!(await runningPid(home))) {
      if (++missing >= 3) return { ok: false, reason: 'exited', logTail: await tailLog(home) };
    } else missing = 0;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, reason: 'timeout', logTail: await tailLog(home) };
}

export async function tailLog(home: string, lines = 6): Promise<string[]> {
  const text = await readFile(logFile(home), 'utf8').catch(() => '');
  return text.trimEnd().split(/\r?\n/).filter(Boolean).slice(-lines);
}

// ── Workspace: folders the phone may start sessions in ─────────────────────

export async function missingWorkspaces(home: string): Promise<string[]> {
  const { projects } = await loadPolicy(home);
  const missing: string[] = [];
  for (const p of projects) {
    const st = await stat(p.path).catch(() => null);
    if (!st?.isDirectory()) missing.push(p.path);
  }
  return missing;
}
