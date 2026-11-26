import type { ProviderId } from '@pocket-agent/protocol';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import type { SessionEventOut } from './registry.js';

/**
 * The chats this PC agent runs for Pocket Agent, kept in a small file as they start and end, so a
 * restart (an update, a crash; Windows stops a process without warning) doesn't end them: the next
 * agent shows them again as waiting, and the next message continues the same conversation.
 *
 * Only ids, agents and folders are written, never anything said in a chat.
 */
export interface HandedOver {
  provider: ProviderId;
  projectPath: string;
}

/** A restart this long after the last change: the chats are let go (they end as before). */
const MAX_AGE_MS = 24 * 60 * 60_000;

export class Handover {
  private readonly live = new Map<string, HandedOver>();
  /** Chats taken over from the last run that haven't been continued yet. */
  private readonly dormant = new Map<string, HandedOver>();

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  private frozen = false;

  /** The agent is stopping: chats it ends now are kept for the next run (they didn't really end). */
  freeze(): void {
    this.frozen = true;
  }

  /** Follows managed chats starting and ending (from the events the PC sends). */
  track(event: SessionEventOut): void {
    if (this.frozen) return;
    const p = event.payload as Record<string, unknown>;
    const id = typeof p['externalSessionId'] === 'string' ? p['externalSessionId'] : undefined;
    if (!id) return;
    if (event.eventType === 'agent.session.started') {
      if (p['mode'] !== 'managed') return;
      const next = { provider: p['provider'] as ProviderId, projectPath: String(p['projectPath'] ?? '') };
      const prev = this.live.get(id);
      if (prev && prev.provider === next.provider && prev.projectPath === next.projectPath) return;
      this.live.set(id, next);
      this.save();
    } else if (event.eventType === 'agent.session.ended') {
      this.dormant.delete(id);
      if (this.live.delete(id)) this.save();
    }
  }

  /** The chats the last run left behind (none when the file is old or unreadable). */
  load(): Array<HandedOver & { id: string }> {
    try {
      if (this.now() - statSync(this.file).mtimeMs > MAX_AGE_MS) return [];
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, HandedOver>;
      const out = Object.entries(saved).flatMap(([id, s]) =>
        s && typeof s.provider === 'string' && typeof s.projectPath === 'string' && s.projectPath
          ? [{ id, provider: s.provider, projectPath: s.projectPath }]
          : [],
      );
      for (const s of out) {
        const chat = { provider: s.provider, projectPath: s.projectPath };
        this.dormant.set(s.id, chat);
        // Still this PC agent's chats: kept for a further restart until they continue or end.
        this.live.set(s.id, chat);
      }
      return out;
    } catch {
      return [];
    }
  }

  /** A chat from the last run, waiting for its next message. */
  dormantChat(id: string): HandedOver | undefined {
    return this.dormant.get(id);
  }

  /** It is being continued (or ended): no longer waiting. */
  take(id: string): HandedOver | undefined {
    const s = this.dormant.get(id);
    this.dormant.delete(id);
    return s;
  }

  private save(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.live)), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // Best effort: without it a restart ends the chats, as before.
    }
  }
}
