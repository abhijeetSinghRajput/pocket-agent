import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Hook events AgentDock listens to. All are observe-only in M3. */
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
/** Every AgentDock hook command contains this marker; it is how we find our own entries. */
export const HOOK_MARKER = '--agentdock-hook';

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
  const tmp = `${file}.agentdock-tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

/** Removes AgentDock entries, keeping every other hook untouched. */
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
 * Adds AgentDock's observe-only hooks to Claude Code settings. Idempotent (re-running replaces our
 * entries), backs the file up first, and never touches permission settings or other hooks.
 */
export async function installHooks(settingsPath: string, command: string): Promise<InstallResult> {
  const { settings, existed } = await readSettings(settingsPath);
  let backupPath: string | null = null;
  if (existed) {
    backupPath = `${settingsPath}.agentdock-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(settingsPath, backupPath);
  }
  const next = withoutOurs(settings);
  const hooks = { ...(next.hooks ?? {}) };
  for (const event of HOOK_EVENTS) {
    const group: HookGroup = {
      ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
      // Short timeout: the relay answers in milliseconds and never blocks Claude Code.
      hooks: [{ type: 'command', command, timeout: 10 }],
    };
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  await writeAtomic(settingsPath, { ...next, hooks });
  return { settingsPath, backupPath, events: [...HOOK_EVENTS] };
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

export async function hooksStatus(settingsPath: string): Promise<{ installed: boolean; events: string[] }> {
  try {
    const { settings } = await readSettings(settingsPath);
    const events = Object.entries(settings.hooks ?? {})
      .filter(([, groups]) => Array.isArray(groups) && groups.some((g) => g.hooks?.some(isOurs)))
      .map(([e]) => e);
    return { installed: events.length > 0, events };
  } catch {
    return { installed: false, events: [] };
  }
}
