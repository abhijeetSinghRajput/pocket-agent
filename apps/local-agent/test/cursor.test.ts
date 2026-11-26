import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURSOR_PROFILE,
  cursorAgentModel,
  cursorAppModel,
  cursorProgram,
  detectCursor,
} from '../src/providers/cursor/cursor.js';

describe('Cursor CLI on the PC', () => {
  it('finds the newest installed version (its own Node and entry point)', () => {
    const local = mkdtempSync(path.join(os.tmpdir(), 'pa-cursor-'));
    const node = process.platform === 'win32' ? 'node.exe' : 'node';
    for (const v of ['2026.10.1-aaa', '2026.11.22-e9042b2', 'notes']) {
      const dir = path.join(local, 'cursor-agent', 'versions', v);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, node), '');
      writeFileSync(path.join(dir, 'index.js'), '');
    }
    expect(cursorProgram(local, local)?.entry).toContain('2026.11.22-e9042b2');
    expect(cursorProgram(local, path.join(local, 'none'))).toBeNull();
  });

  it('model ids: the app uses the name, Cursor its own id with settings', () => {
    const available = ['default[]', 'composer-2.5[fast=true]', 'gpt-5.3-codex[reasoning=medium,fast=false]'];
    expect(available.map(cursorAppModel)).toEqual(['auto', 'composer-2.5', 'gpt-5.3-codex']);
    expect(cursorAgentModel('composer-2.5', available)).toBe('composer-2.5[fast=true]');
    expect(cursorAgentModel('auto', available)).toBe('default[]');
    expect(cursorAgentModel('auto')).toBe('default[]');
  });

  it('signed in from its status; models only then; null when not installed', async () => {
    const program = { node: 'node', entry: 'index.js' };
    const run = (status: string) => async (_c: string, args: string[]) =>
      args[1] === '--version' ? { ok: true, stdout: '2026.11.22-e9042b2\n' } : { ok: true, stdout: status };
    const models = async () => [{ id: 'auto', name: 'Auto', description: '' }];
    expect(await detectCursor({ program, run: run('✓ Logged in as someone'), listModels: models })).toEqual({
      provider: 'cursor',
      version: '2026.11.22-e9042b2',
      signedIn: true,
      models: [{ id: 'auto', name: 'Auto', description: '' }],
    });
    expect(await detectCursor({ program, run: run('Not logged in'), listModels: models })).toMatchObject({
      signedIn: false,
      models: [],
    });
    expect(await detectCursor({ program: null })).toBeNull();
  });

  it('modes are Cursor’s own (Agent, Plan); reopening loads the chat', () => {
    expect(CURSOR_PROFILE.mode('s', 'plan')).toEqual([
      { method: 'session/set_mode', params: { sessionId: 's', modeId: 'plan' } },
    ]);
    expect(CURSOR_PROFILE.mode('s', 'auto')[0]?.params).toMatchObject({ modeId: 'agent' });
    expect(CURSOR_PROFILE.resume).toBe('load');
  });
});
