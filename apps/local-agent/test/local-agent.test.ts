import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentHome } from '../src/paths.js';

describe('agentHome', () => {
  it('uses %APPDATA%\\AgentDock on Windows', () => {
    expect(agentHome({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\AgentDock',
    );
  });

  it('uses XDG_CONFIG_HOME on Linux', () => {
    expect(agentHome({ XDG_CONFIG_HOME: '/x/cfg' }, 'linux', '/home/u')).toBe('/x/cfg/agentdock');
    expect(agentHome({}, 'linux', '/home/u')).toBe('/home/u/.config/agentdock');
  });

  it('honours AGENTDOCK_HOME', () => {
    expect(agentHome({ AGENTDOCK_HOME: os.tmpdir() }, 'win32')).toBe(path.resolve(os.tmpdir()));
  });
});

describe('cli', () => {
  const cli = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
  const tsx = path.join(import.meta.dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [tsx, cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, AGENTDOCK_HOME: mkdtempSync(path.join(os.tmpdir(), 'agentdock-test-')) },
    });

  it('prints its version', () => {
    expect(run('--version').trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports unpaired status as JSON', () => {
    const s = JSON.parse(run('status', '--json'));
    expect(s).toMatchObject({ protocolVersion: 1, paired: false });
  });
});
