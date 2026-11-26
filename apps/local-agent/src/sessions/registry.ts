import {
  createEvent,
  MAX_TEXT_FIELD,
  type AgentStatus,
  type ProviderId,
  type SessionCapabilities,
  type SessionMode,
} from '@pocket-agent/protocol';
import path from 'node:path';

export interface SessionInfo {
  externalSessionId: string;
  provider: ProviderId;
  mode: SessionMode;
  projectPath: string;
  status: AgentStatus;
  capabilities: SessionCapabilities;
  metadata?: Record<string, string>;
}

export interface TrackedSession extends SessionInfo {
  projectName: string;
  /** How we learned about it. Hook data is authoritative over discovery. */
  sources: Set<'hooks' | 'discovery' | 'managed'>;
  pid?: number;
}

/** Any session event the registry emits (envelope carries sessionId = externalSessionId). */
export type SessionEventOut = ReturnType<typeof createEvent> & { sessionId?: string };

export function truncate(text: string, max = MAX_TEXT_FIELD): string {
  if (text.length <= max) return text;
  const marker = `… [${text.length - max + 20} more characters truncated]`;
  return text.slice(0, max - marker.length) + marker;
}

/**
 * The PC's view of live sessions. Every change becomes a protocol event for the outbox.
 * Guarantees the API hears `agent.session.started` before any other event of a session.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, TrackedSession>();

  constructor(private readonly emit: (event: SessionEventOut) => void) {}

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): TrackedSession | undefined {
    return this.sessions.get(id);
  }

  live(): TrackedSession[] {
    return [...this.sessions.values()];
  }

  /** Announces a new session, or re-announces (upsert) when its description changed. */
  announce(info: SessionInfo, source: 'hooks' | 'discovery' | 'managed', extra: { pid?: number } = {}): void {
    const existing = this.sessions.get(info.externalSessionId);
    const metadata = { ...existing?.metadata, ...info.metadata };
    const next: TrackedSession = {
      ...info,
      metadata,
      projectName: path.basename(info.projectPath.replace(/[\\/]+$/, '')) || info.projectPath,
      sources: new Set([...(existing?.sources ?? []), source]),
      pid: extra.pid ?? existing?.pid,
    };
    this.sessions.set(info.externalSessionId, next);
    const changed =
      !existing ||
      existing.status !== next.status ||
      existing.mode !== next.mode ||
      existing.projectPath !== next.projectPath ||
      JSON.stringify(existing.capabilities) !== JSON.stringify(next.capabilities) ||
      JSON.stringify(existing.metadata) !== JSON.stringify(next.metadata);
    if (!changed) return;
    this.emit(
      createEvent(
        'agent.session.started',
        {
          provider: next.provider,
          mode: next.mode,
          externalSessionId: next.externalSessionId,
          projectPath: truncate(next.projectPath, 1024),
          projectName: truncate(next.projectName, 200),
          status: next.status,
          capabilities: next.capabilities,
          ...(Object.keys(metadata).length ? { metadata } : {}),
        },
        { sessionId: next.externalSessionId },
      ),
    );
  }

  setStatus(id: string, status: AgentStatus, currentTask?: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.status === status && currentTask === undefined) return;
    s.status = status;
    this.emit(
      createEvent(
        'agent.session.updated',
        {
          externalSessionId: id,
          status,
          ...(currentTask !== undefined ? { currentTask: truncate(currentTask, 500) } : {}),
        },
        { sessionId: id },
      ),
    );
  }

  /** Changes a session's metadata (re-announced only when a value actually changed). */
  setMetadata(id: string, patch: Record<string, string>): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const { projectName: _name, sources, pid, ...info } = s;
    const source = sources.has('hooks') ? 'hooks' : sources.has('managed') ? 'managed' : 'discovery';
    this.announce({ ...info, metadata: { ...s.metadata, ...patch } }, source, pid ? { pid } : {});
  }

  /** Emits a session-scoped event (tool, permission, output, error). */
  event(id: string, eventType: string, payload: Record<string, unknown>): void {
    if (!this.sessions.has(id)) return;
    this.emit(createEvent(eventType, payload, { sessionId: id }));
  }

  end(id: string, reason: string): void {
    if (!this.sessions.delete(id)) return;
    this.emit(
      createEvent(
        'agent.session.ended',
        { externalSessionId: id, reason: truncate(reason, 200) },
        { sessionId: id },
      ),
    );
  }

  /** State for the post-connect snapshot. */
  snapshot() {
    return createEvent('agent.sessions.snapshot', {
      sessions: this.live()
        .slice(0, 500)
        .map((s) => ({ externalSessionId: s.externalSessionId, status: s.status })),
    });
  }
}
