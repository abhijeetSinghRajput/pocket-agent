import type { AgentStatus } from '@pocket-agent/protocol';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionRegistry } from '../../sessions/registry.js';
import { MONITOR_ONLY } from './hooks.js';

/**
 * Best-effort discovery of running Claude Code sessions from `<claude config>/sessions/<pid>.json`.
 * This is an UNDOCUMENTED Claude Code file format: every field is optional and anything
 * unexpected is ignored. Only `<pid>.json` files are read — never the neighbouring `*.key` files
 * or `ide/*.lock` files, which contain local auth tokens.
 */
export interface DiscoveredSession {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  kind?: string;
  entrypoint?: string;
  name?: string;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function readSessionsDir(dir: string): Promise<DiscoveredSession[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: DiscoveredSession[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue; // strictly <pid>.json
    try {
      const j = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as Record<string, unknown>;
      const str = (k: string) => (typeof j[k] === 'string' ? (j[k] as string) : undefined);
      const pid = typeof j['pid'] === 'number' ? j['pid'] : Number(f.slice(0, -5));
      const sessionId = str('sessionId');
      const cwd = str('cwd');
      if (!sessionId || !cwd || !Number.isInteger(pid)) continue;
      out.push({
        pid,
        sessionId,
        cwd,
        ...(str('status') ? { status: str('status') } : {}),
        ...(str('kind') ? { kind: str('kind') } : {}),
        ...(str('entrypoint') ? { entrypoint: str('entrypoint') } : {}),
        ...(str('name') ? { name: str('name') } : {}),
      });
    } catch {
      // partially written or unknown format: skip
    }
  }
  return out;
}

export function mapStatus(status: string | undefined): AgentStatus | null {
  if (status === 'idle') return 'WaitingForInput';
  if (status === 'busy' || status === 'running') return 'Running';
  return null;
}

export class ClaudeDiscovery {
  private timer: NodeJS.Timeout | null = null;
  /** Sessions this scanner has seen, with their pid, so it can tell when they exit. */
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly registry: SessionRegistry,
    private readonly opts: {
      isManaged: (sessionId: string) => boolean;
      hooksInstalled: () => boolean;
      alive?: (pid: number) => boolean;
      intervalMs?: number;
    },
  ) {}

  start(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs ?? 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    const alive = this.opts.alive ?? pidAlive;
    const found = (await readSessionsDir(this.dir)).filter(
      (d) => !this.opts.isManaged(d.sessionId) && alive(d.pid),
    );
    const live = new Set(found.map((d) => d.sessionId));

    for (const d of found) {
      this.seen.set(d.sessionId, d.pid);
      const tracked = this.registry.get(d.sessionId);
      const status = mapStatus(d.status);
      const metadata = {
        ...(d.entrypoint ? { entrypoint: d.entrypoint } : {}),
        ...(d.kind ? { kind: d.kind } : {}),
        ...(d.name ? { name: d.name } : {}),
      };
      if (!tracked) {
        this.registry.announce(
          {
            externalSessionId: d.sessionId,
            provider: 'claude-code',
            mode: 'observed',
            projectPath: d.cwd,
            status: status ?? 'Running',
            // Without hooks we can only watch the coarse status; never claim more.
            // Status only until this session's own hooks are seen. Claude Code loads hooks when a
            // session starts, so a session older than `hooks install` never reports — never claim more.
            capabilities: MONITOR_ONLY,
            metadata: { ...metadata, hooks: this.opts.hooksInstalled() ? 'not-connected' : 'not-installed' },
          },
          'discovery',
          { pid: d.pid },
        );
        continue;
      }
      // Enrich hook-reported sessions with entrypoint etc. (re-announces only if something changed).
      this.registry.announce({ ...tracked, metadata }, 'discovery', { pid: d.pid });
      // Hooks are precise; use the coarse file status only for sessions without hook data.
      if (!tracked.sources.has('hooks') && status) this.registry.setStatus(d.sessionId, status);
    }

    // A session we saw via its process file whose process is gone has ended.
    for (const [sessionId] of this.seen) {
      if (live.has(sessionId)) continue;
      this.seen.delete(sessionId);
      if (this.registry.get(sessionId)?.pid !== undefined) this.registry.end(sessionId, 'process_exited');
    }
  }
}
