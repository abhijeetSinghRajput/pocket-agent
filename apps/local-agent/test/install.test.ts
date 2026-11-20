import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  hooksStatus,
  installHooks,
  relayCommand,
  uninstallHooks,
} from '../src/providers/claude-code/install.js';

const CMD = relayCommand(
  'C:\\Program Files\\nodejs\\node.exe',
  'C:\\pocket-agent\\dist\\hook-relay.js',
  'C:\\Users\\dev\\AppData\\Roaming\\Pocket Agent',
);

function tempSettings(content?: unknown) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-settings-'));
  const file = path.join(dir, 'settings.json');
  if (content !== undefined)
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return { dir, file, read: () => JSON.parse(readFileSync(file, 'utf8')) };
}

const userSettings = {
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm -rf *)'] },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-linter.sh' }] }],
  },
};

describe('hooks installer', () => {
  it('quotes paths with forward slashes and marks the command as ours', () => {
    expect(CMD).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/pocket-agent/dist/hook-relay.js" --pocket-agent-hook --home "C:/Users/dev/AppData/Roaming/Pocket Agent"',
    );
  });

  it('adds observe-only hooks, keeps everything else, and backs up the original', async () => {
    const t = tempSettings(userSettings);
    const r = await installHooks(t.file, CMD);
    const s = t.read();
    expect(s.model).toBe('opus');
    expect(s.permissions).toEqual(userSettings.permissions); // never touches permissions
    expect(Object.keys(s.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('my-own-linter.sh');
    expect(s.hooks.PreToolUse[1]).toEqual({
      matcher: '*',
      hooks: [{ type: 'command', command: CMD, timeout: 10 }],
    });
    expect(s.hooks.SessionStart[0]).toEqual({ hooks: [{ type: 'command', command: CMD, timeout: 10 }] });
    // A held permission request (phone decision, ≤ 5 min) must not be cut off by Claude Code.
    expect(s.hooks.PermissionRequest[0].hooks[0].timeout).toBe(330);
    expect((await hooksStatus(t.file)).permissionTimeoutS).toBe(330);
    expect(r.backupPath).not.toBeNull();
    expect(JSON.parse(readFileSync(r.backupPath!, 'utf8'))).toEqual(userSettings);
  });

  it('is idempotent', async () => {
    const t = tempSettings(userSettings);
    await installHooks(t.file, CMD);
    await installHooks(t.file, CMD);
    const s = t.read();
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.Stop).toHaveLength(1);
  });

  it('uninstall restores the user’s hooks exactly', async () => {
    const t = tempSettings(userSettings);
    await installHooks(t.file, CMD);
    expect((await hooksStatus(t.file)).installed).toBe(true);
    expect((await uninstallHooks(t.file)).removed).toBe(HOOK_EVENTS.length);
    expect(t.read()).toEqual(userSettings);
    expect((await hooksStatus(t.file)).installed).toBe(false);
  });

  it('creates the settings file when there is none, and removes the hooks key on uninstall', async () => {
    const t = tempSettings();
    const r = await installHooks(t.file, CMD);
    expect(r.backupPath).toBeNull();
    await uninstallHooks(t.file);
    expect(t.read()).toEqual({});
  });

  it('refuses to modify settings it cannot parse', async () => {
    const t = tempSettings('{ "model": "opus", // comment\n }');
    await expect(installHooks(t.file, CMD)).rejects.toThrow(/Refusing to modify/);
    expect(readFileSync(t.file, 'utf8')).toContain('// comment'); // untouched
    expect(readdirSync(t.dir)).toEqual(['settings.json']); // no backup, no temp file
  });
});
