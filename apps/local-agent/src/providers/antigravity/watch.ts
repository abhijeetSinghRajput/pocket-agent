import type { SessionCapabilities } from '@pocket-agent/protocol';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionRegistry } from '../../sessions/registry.js';
import { AppServerClient, type Transport } from '../codex/rpc.js';

/**
 * Antigravity chats the user runs themselves (the `agy` terminal), shown on the phone by status
 * only: Antigravity keeps its conversations in its own format, so only whether a chat is working
 * or waiting, its title and its folder are known. Found from the times of Antigravity's own
 * conversation files (never their contents); title and folder come from Antigravity's own session
 * list. Chats Pocket Agent runs itself are left out.
 */

export const ANTIGRAVITY_STATUS_ONLY: SessionCapabilities = {
  monitor: true,
  remoteApproval: false,
  instructAnytime: false,
  instructBetweenTurns: false,
  interrupt: false,
};

export interface ListedSession {
  sessionId: string;
  cwd: string;
  title?: string;
}

/** Where Antigravity keeps its conversations (one `<session id>.db` each). */
export const antigravityConversations = (home = os.homedir()) =>
  path.join(home, '.gemini', 'antigravity-cli', 'conversations');

/** "/C:/x/y" (as Antigravity writes folders) → "C:/x/y". */
const cleanPath = (p: string) => p.replace(/^\/([A-Za-z]:[\\/])/, '$1');

/** Antigravity's own session list, asked of a short-lived `agy acp` (closed right after). */
export async function listAntigravitySessions(connect: () => Transport): Promise<ListedSession[]> {
  let transport: Transport;
  try {
    transport = connect();
  } catch {
    return [];
  }
  const client = new AppServerClient(
    transport,
    {
      notification: () => undefined,
      request: () => Promise.reject(new Error('not now')),
      closed: () => undefined,
    },
    () => undefined,
    { name: 'agy acp', jsonrpc: true },
  );
  try {
    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version: '0' },
      },
      20_000,
    );
    const res = await client.request<{ sessions?: Array<Record<string, unknown>> }>(
      'session/list',
      {},
      20_000,
    );
    return (res.sessions ?? []).flatMap((s) =>
      typeof s['sessionId'] === 'string' && typeof s['cwd'] === 'string'
        ? [
            {
              sessionId: s['sessionId'],
              cwd: cleanPath(s['cwd']),
              ...(typeof s['title'] === 'string' && s['title'] ? { title: s['title'].slice(0, 200) } : {}),
            },
          ]
        : [],
    );
  } catch {
    return [];
  } finally {
    client.close();
  }
}

interface Followed {
  /** Last time its files changed (ms). */
  changedAt: number;
  announced: boolean;
}

export class AntigravityWatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly followed = new Map<string, Followed>();
  /** Folder and title by session, from Antigravity's list. */
  private readonly known = new Map<string, ListedSession>();
  private listedAt = 0;
  private scanning = false;
  /**
   * Only chats that change after the watcher started are picked up: a chat Pocket Agent ran before
   * the PC agent restarted (now ended) never shows again as one started in the terminal.
   */
  private readonly startedAt: number;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly opts: {
      /** Antigravity's conversations folder. */
      dir: string;
      /** Chats Pocket Agent runs (or ran) itself: left alone. */
      isOurs: (id: string) => boolean;
      list: () => Promise<ListedSession[]>;
      intervalMs?: number;
      /** A chat whose files changed this recently is working. */
      busyMs?: number;
      /** A file that hasn't changed for this long isn't picked up. */
      recentMs?: number;
      /** A followed chat quiet for this long has ended. */
      idleEndMs?: number;
      now?: () => number;
    },
  ) {
    this.startedAt = (opts.now ?? Date.now)();
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  start(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const now = this.now();
      const changed = await this.changeTimes();
      const recent = this.opts.recentMs ?? 10 * 60_000;
      const busy = this.opts.busyMs ?? 20_000;
      const unknown = [...changed.keys()].filter(
        (id) =>
          !this.known.has(id) &&
          !this.opts.isOurs(id) &&
          (changed.get(id) ?? 0) > this.startedAt &&
          now - (changed.get(id) ?? 0) <= recent,
      );
      // Folder and title of chats seen for the first time (Antigravity asked at most every 30 s).
      if (unknown.length && now - this.listedAt >= 30_000) {
        this.listedAt = now;
        for (const s of await this.opts.list()) this.known.set(s.sessionId, s);
      }
      for (const [id, at] of changed) {
        if (this.opts.isOurs(id)) {
          this.followed.delete(id);
          continue;
        }
        const info = this.known.get(id);
        let f = this.followed.get(id);
        if (!f) {
          if (at <= this.startedAt || now - at > recent || !info) continue;
          f = { changedAt: at, announced: false };
          this.followed.set(id, f);
        }
        f.changedAt = Math.max(f.changedAt, at);
        const status = now - f.changedAt <= busy ? 'Running' : 'WaitingForInput';
        if (!f.announced && info) {
          this.registry.announce(
            {
              externalSessionId: id,
              provider: 'antigravity',
              mode: 'observed',
              projectPath: info.cwd,
              status,
              capabilities: ANTIGRAVITY_STATUS_ONLY,
              metadata: { entrypoint: 'cli', watch: 'status', ...(info.title ? { name: info.title } : {}) },
            },
            'discovery',
          );
          f.announced = true;
        } else if (f.announced) {
          this.registry.setStatus(id, status);
        }
      }
      // Quiet for long enough: ended (Antigravity leaves no sign when it exits).
      const idle = this.opts.idleEndMs ?? 30 * 60_000;
      for (const [id, f] of this.followed) {
        if (now - f.changedAt < idle) continue;
        this.followed.delete(id);
        if (f.announced && this.registry.get(id)?.mode === 'observed') this.registry.end(id, 'idle');
      }
    } finally {
      this.scanning = false;
    }
  }

  /** When each chat's files last changed (the database and its write-ahead log). */
  private async changeTimes(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const names = await readdir(this.opts.dir).catch(() => [] as string[]);
    for (const n of names) {
      const m = /^([0-9a-f-]{36})\.db(-wal)?$/i.exec(n);
      if (!m) continue;
      const st = await stat(path.join(this.opts.dir, n)).catch(() => null);
      if (!st) continue;
      out.set(m[1]!, Math.max(out.get(m[1]!) ?? 0, st.mtimeMs));
    }
    return out;
  }
}
