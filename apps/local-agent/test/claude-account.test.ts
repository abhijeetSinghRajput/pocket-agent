import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readClaudeAccount } from '../src/providers/claude-code/account.js';

describe('the account Claude Code is signed in with', () => {
  const home = (json?: unknown) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pa-claude-account-'));
    if (json !== undefined) writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(json));
    return dir;
  };

  it('is the email Claude Code keeps after sign-in, and nothing else', async () => {
    expect(
      await readClaudeAccount(
        home({ oauthAccount: { emailAddress: 'me@example.com', accountUuid: 'x' }, other: 1 }),
      ),
    ).toEqual({ email: 'me@example.com', plan: null });
  });

  it('is null when signed out, missing, or unreadable', async () => {
    expect(await readClaudeAccount(home({}))).toBeNull();
    expect(await readClaudeAccount(home())).toBeNull();
    expect(await readClaudeAccount(home({ oauthAccount: { emailAddress: 42 } }))).toBeNull();
  });
});
