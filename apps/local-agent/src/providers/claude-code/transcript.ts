import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** At most this much of a transcript is read per hook (a long turn is caught up over several hooks). */
const MAX_READ = 2 * 1024 * 1024;
const MAX_SEEN = 2_000;

interface Tail {
  path: string;
  offset: number;
  /** An incomplete last line, finished by the next read. */
  rest: string;
  seen: Set<string>;
  /** The last text reported, from either source (to skip Stop's copy of it, or the transcript's). */
  last: string;
}

/**
 * Follows a Claude Code session's transcript (JSONL, `transcript_path` in every hook payload) to
 * report what Claude says between tool calls. Hooks only carry the last message of a turn; the
 * transcript has each text block as its own line, written before the tool call that follows it, so
 * reading it at each hook keeps the order the editor shows.
 *
 * Only Claude's own text blocks leave the PC (the same as its final reply already does). Thinking,
 * tool inputs and results, subagent (sidechain) lines and everything else in the file are ignored.
 */
export class TranscriptTail {
  private readonly tails = new Map<string, Tail>();

  /**
   * Remember where the session's transcript is. The first time, start at its end: a session found
   * mid-way doesn't replay its history.
   */
  attach(sessionId: string, path: string | undefined): void {
    if (!path) return;
    const t = this.tails.get(sessionId);
    if (t && t.path === path) return;
    this.tails.set(sessionId, { path, offset: size(path), rest: '', seen: new Set(), last: t?.last ?? '' });
  }

  /** New assistant text blocks since the last call, oldest first. */
  read(sessionId: string): string[] {
    const t = this.tails.get(sessionId);
    if (!t) return [];
    let chunk: string;
    try {
      const fd = openSync(t.path, 'r');
      try {
        const total = fstatSync(fd).size;
        if (total < t.offset) {
          // Rewritten (e.g. compacted): start over at its end.
          t.offset = total;
          t.rest = '';
          return [];
        }
        const len = Math.min(total - t.offset, MAX_READ);
        if (len <= 0) return [];
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, t.offset);
        t.offset += len;
        chunk = buf.toString('utf8');
      } finally {
        closeSync(fd);
      }
    } catch {
      return []; // unreadable now; try again at the next hook
    }

    const lines = (t.rest + chunk).split('\n');
    t.rest = lines.pop() ?? '';
    const out: string[] = [];
    for (const line of lines) {
      const text = assistantText(line);
      if (!text) continue;
      if (text.id) {
        if (t.seen.has(text.id)) continue;
        t.seen.add(text.id);
        if (t.seen.size > MAX_SEEN) t.seen.delete(t.seen.values().next().value!);
      }
      if (same(text.text, t.last)) continue; // already reported (Stop's last message)
      t.last = text.text;
      out.push(text.text);
    }
    return out;
  }

  /** Text reported from elsewhere (Stop's `last_assistant_message`); returns false if it was already sent. */
  claim(sessionId: string, text: string): boolean {
    const t = this.tails.get(sessionId);
    if (!t) return true;
    if (same(text, t.last)) return false;
    t.last = text;
    return true;
  }

  /** Skip what was written meanwhile (a turn Pocket Agent ran itself and already reported). */
  skipToEnd(sessionId: string): void {
    const t = this.tails.get(sessionId);
    if (!t) return;
    t.offset = size(t.path);
    t.rest = '';
  }

  forget(sessionId: string): void {
    this.tails.delete(sessionId);
  }
}

function size(path: string): number {
  try {
    const fd = openSync(path, 'r');
    try {
      return fstatSync(fd).size;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 0;
  }
}

const same = (a: string, b: string) => a.trim() === b.trim();

/** The text of a main-thread assistant text line, or undefined for anything else. */
function assistantText(line: string): { id: string | undefined; text: string } | undefined {
  if (!line.includes('"assistant"') || !line.includes('"text"')) return undefined; // cheap pre-filter
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (o['type'] !== 'assistant' || o['isSidechain'] === true || o['isMeta'] === true) return undefined;
  const content = (o['message'] as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) return undefined;
  return { id: typeof o['uuid'] === 'string' ? o['uuid'] : undefined, text };
}
