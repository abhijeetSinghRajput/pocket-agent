import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { claudeConfigDir } from './install.js';

export interface SavedConversation {
  /** The folder the session ran in, as Claude Code recorded it. */
  cwd: string;
}

/**
 * A session's conversation as Claude Code keeps it on this PC
 * (`<claude config>/projects/<project>/<session id>.jsonl`), or null when it is gone.
 *
 * Continuing an ended session runs it in the folder recorded here, never in one the server names:
 * the session already ran there because the PC owner started it there.
 */
export async function findConversation(
  sessionId: string,
  configDir = claudeConfigDir(),
): Promise<SavedConversation | null> {
  if (!/^[\w-]{1,200}$/.test(sessionId)) return null;
  const root = path.join(configDir, 'projects');
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    const cwd = await recordedCwd(file);
    if (!cwd) continue;
    const st = await stat(cwd).catch(() => null);
    if (st?.isDirectory()) return { cwd };
  }
  return null;
}

/** The first `cwd` the transcript records (its first entries carry it). */
async function recordedCwd(file: string): Promise<string | null> {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of lines) {
      if (++n > 200) break;
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry.cwd === 'string' && entry.cwd) return entry.cwd;
      } catch {
        /* a partial line: skip */
      }
    }
  } finally {
    lines.close();
  }
  return null;
}
