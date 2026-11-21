import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_MESSAGE } from '@pocket-agent/protocol';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { PastedFile } from '../../attachments.js';

export type TranscriptEntry =
  | { kind: 'text' | 'thought'; text: string }
  /** Photos/PDFs the user attached to a prompt in the editor (only read when sharing is on). */
  | { kind: 'files'; files: PastedFile[] };

/** "Thought for 2s", as Claude Code shows it. */
export function thoughtLabel(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `Thought for ${s}s` : `Thought for ${Math.floor(s / 60)}m ${s % 60}s`;
}

/** At most this much of a transcript is read per hook (a long turn is caught up over several hooks). */
const MAX_READ = 16 * 1024 * 1024;
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

  /**
   * What Claude wrote since the last call, oldest first: its text blocks, and how long it thought
   * before them (the duration only, never the thinking itself).
   */
  read(sessionId: string, withFiles = false): TranscriptEntry[] {
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
    const out: TranscriptEntry[] = [];
    for (const line of lines) {
      const thought = thinkingTime(line);
      if (thought) {
        // One "Thought for …" per reply: its thinking can span several lines; the first has the time.
        if (!t.seen.has(thought.messageId)) {
          t.seen.add(thought.messageId);
          out.push({ kind: 'thought', text: thoughtLabel(thought.ms) });
        }
        continue;
      }
      if (withFiles) {
        const pasted = userFiles(line);
        if (pasted) {
          if (!t.seen.has(pasted.id)) {
            t.seen.add(pasted.id);
            out.push({ kind: 'files', files: pasted.files });
          }
          continue;
        }
      }
      const text = assistantText(line);
      if (!text) continue;
      if (text.id) {
        if (t.seen.has(text.id)) continue;
        t.seen.add(text.id);
        if (t.seen.size > MAX_SEEN) t.seen.delete(t.seen.values().next().value!);
      }
      if (same(text.text, t.last)) continue; // already reported (Stop's last message)
      t.last = text.text;
      out.push({ kind: 'text', text: text.text });
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

const PASTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);

/**
 * Files the user attached to a prompt: image/document blocks at the top level of a main-thread
 * user message. Files inside tool results (what Claude read itself) are not the user's attachments.
 */
function userFiles(line: string): { id: string; files: PastedFile[] } | undefined {
  if (!line.includes('"base64"') || !line.includes('"type":"user"')) return undefined; // cheap pre-filter
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (o['type'] !== 'user' || o['isSidechain'] === true || o['isMeta'] === true) return undefined;
  const content = (o['message'] as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content) || typeof o['uuid'] !== 'string') return undefined;
  const files: PastedFile[] = [];
  for (const b of content as Array<Record<string, unknown>>) {
    if (b?.['type'] !== 'image' && b?.['type'] !== 'document') continue;
    const src = b['source'] as { type?: unknown; media_type?: unknown; data?: unknown } | undefined;
    if (src?.type !== 'base64' || typeof src.media_type !== 'string' || typeof src.data !== 'string')
      continue;
    if (!PASTED_MIME.has(src.media_type)) continue;
    const data = Buffer.from(src.data, 'base64');
    if (data.length && data.length <= ATTACHMENT_MAX_BYTES && files.length < ATTACHMENT_MAX_PER_MESSAGE)
      files.push({ mime: src.media_type, data });
  }
  return files.length ? { id: `files:${o['uuid']}`, files } : undefined;
}

/** How long Claude thought, from a main-thread thinking line (the duration only). */
function thinkingTime(line: string): { messageId: string; ms: number } | undefined {
  if (!line.includes('"thinkingDurationMs"')) return undefined; // cheap pre-filter
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (o['type'] !== 'assistant' || o['isSidechain'] === true) return undefined;
  const ms = o['thinkingDurationMs'];
  const id = (o['message'] as { id?: unknown } | undefined)?.id;
  if (typeof ms !== 'number' || !(ms >= 0) || typeof id !== 'string') return undefined;
  return { messageId: `think:${id}`, ms };
}

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
