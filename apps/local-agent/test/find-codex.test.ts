import { describe, expect, it } from 'vitest';
import { findCodex } from '../src/providers/codex/rpc.js';

describe('finding Codex on the PC', () => {
  const only =
    (...files: string[]) =>
    (f: string) =>
      files.includes(f);
  const home = String.raw`C:\Users\me`;

  it('CODEX_PATH wins', () => {
    const custom = String.raw`X:\tools\codex.exe`;
    expect(findCodex({ CODEX_PATH: custom, PATH: '' }, 'win32', home, only())).toBe(custom);
  });

  it('finds npm’s Windows shim on PATH, or in npm’s folder when PATH is older than the install', () => {
    const shim = String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd`;
    const npm = String.raw`C:\Users\me\AppData\Roaming\npm`;
    expect(findCodex({ PATH: String.raw`C:\Windows;` + npm }, 'win32', home, only(shim))).toBe(shim);
    expect(
      findCodex(
        { PATH: String.raw`C:\Windows`, APPDATA: String.raw`C:\Users\me\AppData\Roaming` },
        'win32',
        home,
        only(shim),
      ),
    ).toBe(shim);
  });

  it('finds Homebrew’s Codex on a Mac even with launchd’s short PATH', () => {
    expect(findCodex({ PATH: '/usr/bin:/bin' }, 'darwin', '/Users/me', only('/opt/homebrew/bin/codex'))).toBe(
      '/opt/homebrew/bin/codex',
    );
  });

  it('is null when there is no Codex', () => {
    expect(findCodex({ PATH: '/usr/bin' }, 'linux', '/home/me', only())).toBeNull();
  });
});
