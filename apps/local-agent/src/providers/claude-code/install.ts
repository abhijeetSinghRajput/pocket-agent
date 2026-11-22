import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Hook events Pocket Agent listens to. All are observe-only in M3. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const;

const TOOL_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
/** Hooks that may wait for the phone. */
const HOLDING_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);
/** Seconds Claude Code waits for the PermissionRequest hook (> the 5-minute remote wait + margin). */
export const PERMISSION_HOOK_TIMEOUT_S = 330;

/** Every Pocket Agent hook command contains this marker; it is how we find our own entries. */
export const HOOK_MARKER = '--pocket-agent-hook';

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(claudeConfigDir(env), 'settings.json');
}

/** Forward slashes and quotes work for both shells Claude Code may use on Windows. */
export function relayCommand(nodePath: string, relayPath: string, home: string): string {
  const q = (p: string) => `"${p.replaceAll('\\', '/')}"`;
  return `${q(nodePath)} ${q(relayPath)} ${HOOK_MARKER} --home ${q(home)}`;
}

type HookHandler = { type?: string; command?: string; [k: string]: unknown };
type HookGroup = { matcher?: string; hooks?: HookHandler[]; [k: string]: unknown };
type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

const isOurs = (h: HookHandler) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER);

async function readSettings(file: string): Promise<{ settings: Settings; existed: boolean }> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { settings: {}, existed: false };
  }
  if (!raw.trim()) return { settings: {}, existed: true };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return { settings: parsed as Settings, existed: true };
  } catch (e) {
    // Never overwrite a file we can't understand.
    throw new Error(`Refusing to modify ${file}: it is not valid JSON (${(e as Error).message})`, {
      cause: e,
    });
  }
}

async function writeAtomic(file: string, settings: Settings): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.pocket-agent-tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

/** Removes Pocket Agent entries, keeping every other hook untouched. */
function withoutOurs(settings: Settings): Settings {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return settings;
  const next: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const kept = groups
      .map((g) => (Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (kept.length) next[event] = kept;
  }
  const { hooks: _removed, ...rest } = settings;
  return Object.keys(next).length ? { ...rest, hooks: next } : rest;
}

export interface InstallResult {
  settingsPath: string;
  backupPath: string | null;
  events: string[];
}

/**
 * Adds Pocket Agent's observe-only hooks to Claude Code settings. Idempotent (re-running replaces our
 * entries), backs the file up first, and never touches permission settings or other hooks.
 */
/** The command our hooks run, as found in the settings (to re-install with the same one). */
export async function installedCommand(settingsPath: string): Promise<string | null> {
  try {
    const { settings } = await readSettings(settingsPath);
    for (const groups of Object.values(settings.hooks ?? {})) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        const ours = (Array.isArray(g.hooks) ? g.hooks : []).find(isOurs);
        if (ours && typeof ours['command'] === 'string') return ours['command'];
      }
    }
  } catch {
    /* unreadable: nothing to update */
  }
  return null;
}

export async function installHooks(settingsPath: string, command: string): Promise<InstallResult> {
  const { settings, existed } = await readSettings(settingsPath);
  let backupPath: string | null = null;
  if (existed) {
    backupPath = `${settingsPath}.pocket-agent-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(settingsPath, backupPath);
  }
  const next = withoutOurs(settings);
  const hooks = { ...(next.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    const group: HookGroup = {
      ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
      // The relay answers in milliseconds, except a PermissionRequest, or a question from Claude
      // (PreToolUse of AskUserQuestion), held for an answer from the phone (Away mode, ≤ 5 min):
      // those timeouts are longer so Claude Code doesn't cut them off first.
      hooks: [
        { type: 'command', command, timeout: HOLDING_EVENTS.has(event) ? PERMISSION_HOOK_TIMEOUT_S : 10 },
      ],
    };
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  await writeAtomic(settingsPath, { ...next, hooks });
  return { settingsPath, backupPath, events: [...HOOK_EVENTS] };
}

/**
 * True when every Pocket Agent hook is present, current, and runs `command`. Callers skip
 * re-installing then, so running setup twice neither rewrites settings.json nor piles up backups.
 */
export async function hooksUpToDate(settingsPath: string, command: string): Promise<boolean> {
  const st = await hooksStatus(settingsPath);
  if (!st.installed || st.outdated) return false;
  if (HOOK_EVENTS.some((e) => !st.events.includes(e))) return false;
  try {
    const { settings } = await readSettings(settingsPath);
    // Exactly one entry of ours per event, all with this command.
    return HOOK_EVENTS.every((e) => {
      const ours = (settings.hooks?.[e] ?? [])
        .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : []))
        .filter(isOurs);
      return ours.length === 1 && ours[0]!.command === command;
    });
  } catch {
    return false;
  }
}

export async function uninstallHooks(settingsPath: string): Promise<{ removed: number }> {
  const { settings, existed } = await readSettings(settingsPath);
  if (!existed) return { removed: 0 };
  const before = countOurs(settings);
  if (!before) return { removed: 0 };
  await writeAtomic(settingsPath, withoutOurs(settings));
  return { removed: before };
}

function countOurs(settings: Settings): number {
  return Object.values(settings.hooks ?? {})
    .filter(Array.isArray)
    .flat()
    .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : []))
    .filter(isOurs).length;
}

export async function hooksStatus(settingsPath: string): Promise<{
  installed: boolean;
  events: string[];
  permissionTimeoutS: number | null;
  /** Installed by an older version: re-installing updates our entries. */
  outdated: boolean;
}> {
  try {
    const { settings } = await readSettings(settingsPath);
    const events = Object.entries(settings.hooks ?? {})
      .filter(([, groups]) => Array.isArray(groups) && groups.some((g) => g.hooks?.some(isOurs)))
      .map(([e]) => e);
    const permissionHook = (settings.hooks?.['PermissionRequest'] ?? [])
      .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : []))
      .find(isOurs);
    const t = permissionHook?.['timeout'];
    const pre = (settings.hooks?.['PreToolUse'] ?? [])
      .flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : []))
      .find(isOurs)?.['timeout'];
    const installed = events.length > 0;
    return {
      installed,
      events,
      permissionTimeoutS: typeof t === 'number' ? t : null,
      outdated: installed && !(typeof pre === 'number' && pre >= PERMISSION_HOOK_TIMEOUT_S),
    };
  } catch {
    return { installed: false, events: [], permissionTimeoutS: null, outdated: false };
  }
}
