import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAccount } from '@pocket-agent/protocol';

/**
 * The account Claude Code is signed in with on this PC: the email Claude Code itself keeps in
 * `~/.claude.json` (its `oauthAccount`, written at sign-in). Only the email is read; tokens live
 * elsewhere and are never touched. Null when it isn't there (signed out, or an API key).
 */
export async function readClaudeAccount(home: string): Promise<AgentAccount | null> {
  try {
    const json = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8')) as {
      oauthAccount?: { emailAddress?: unknown };
    };
    const email = json.oauthAccount?.emailAddress;
    return typeof email === 'string' && email.includes('@') && email.length <= 254
      ? { email, plan: null }
      : null;
  } catch {
    return null;
  }
}
