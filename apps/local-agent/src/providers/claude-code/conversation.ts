import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { claudeConfigDir } from './install.js';

/**
 * Whether Claude Code still has this session's conversation on this PC
 * (`<claude config>/projects/<project>/<session id>.jsonl`), so it can be continued.
 */
export async function conversationExists(sessionId: string, configDir = claudeConfigDir()): Promise<boolean> {
  if (!/^[\w-]{1,200}$/.test(sessionId)) return false;
  const root = path.join(configDir, 'projects');
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  return dirs.some((d) => d.isDirectory() && existsSync(path.join(root, d.name, `${sessionId}.jsonl`)));
}
