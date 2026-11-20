import type { Platform } from '@agentdock/protocol';
import path from 'node:path';
import { IngestServer } from './ingest-server.js';
import { AgentLink, type LinkEvents } from './link.js';
import { Outbox } from './outbox.js';
import { ClaudeDiscovery } from './providers/claude-code/discovery.js';
import { ClaudeHookHandler } from './providers/claude-code/hooks.js';
import { claudeConfigDir, defaultSettingsPath, hooksStatus } from './providers/claude-code/install.js';
import { ManagedSessions, type QueryFn } from './providers/claude-code/managed.js';
import { SessionRegistry, type SessionEventOut } from './sessions/registry.js';

export interface ServiceOptions {
  home: string;
  apiUrl: string;
  deviceId: string;
  secret: string;
  agentVersion: string;
  platform: Platform;
  query: QueryFn;
  log: LinkEvents['log'] extends [infer L, infer M] ? (level: L, msg: M) => void : never;
  /** Overrides for tests. */
  claudeDir?: string;
  discoveryIntervalMs?: number;
  heartbeatMs?: number;
}

/**
 * The running Local Agent: backend link + event outbox + session registry + Claude Code
 * integration (hooks, discovery, managed sessions) + the local ingest endpoint.
 */
export class AgentService {
  readonly outbox = new Outbox<SessionEventOut>();
  readonly registry: SessionRegistry;
  readonly managed: ManagedSessions;
  readonly link: AgentLink;
  readonly ingest: IngestServer;
  private readonly hooks: ClaudeHookHandler;
  private readonly discovery: ClaudeDiscovery;
  private hooksInstalled = false;

  constructor(private readonly opts: ServiceOptions) {
    this.registry = new SessionRegistry((e) => this.enqueue(e));
    this.managed = new ManagedSessions(this.registry, opts.query, opts.log);
    this.hooks = new ClaudeHookHandler(this.registry, this.managed.isManaged);
    const claudeDir = opts.claudeDir ?? claudeConfigDir();
    this.discovery = new ClaudeDiscovery(path.join(claudeDir, 'sessions'), this.registry, {
      isManaged: this.managed.isManaged,
      hooksInstalled: () => this.hooksInstalled,
      ...(opts.discoveryIntervalMs ? { intervalMs: opts.discoveryIntervalMs } : {}),
    });
    this.link = new AgentLink({
      apiUrl: opts.apiUrl,
      deviceId: opts.deviceId,
      secret: opts.secret,
      agentVersion: opts.agentVersion,
      platform: opts.platform,
      activeSessions: () => this.registry.live().length,
      ...(opts.heartbeatMs ? { heartbeatMs: opts.heartbeatMs } : {}),
    });
    this.ingest = new IngestServer(opts.home, {
      hook: (p) => this.hooks.handle(p),
      listSessions: () =>
        this.registry.live().map((s) => ({
          externalSessionId: s.externalSessionId,
          mode: s.mode,
          status: s.status,
          projectPath: s.projectPath,
          sources: [...s.sources],
        })),
      startSession: async (b) => ({ externalSessionId: await this.managed.start(b) }),
      stopSession: (id) => this.managed.stop(id),
    });

    this.link.on('connected', () => this.flush());
    this.link.on('message', (msg) => {
      if (msg.eventType === 'ack') this.outbox.ack(msg.payload.ackEventId);
    });
  }

  private enqueue(event: SessionEventOut): void {
    this.outbox.push(event);
    this.link.send(event);
  }

  /** After (re)connecting: replay everything unacknowledged, in order, then the state snapshot. */
  private flush(): void {
    for (const e of this.outbox.pending()) this.link.send(e);
    this.link.send(this.registry.snapshot());
  }

  async start(): Promise<void> {
    const settings = this.opts.claudeDir
      ? path.join(this.opts.claudeDir, 'settings.json')
      : defaultSettingsPath();
    this.hooksInstalled = (await hooksStatus(settings)).installed;
    await this.ingest.start();
    this.discovery.start();
    this.link.start();
  }

  get hooksAreInstalled(): boolean {
    return this.hooksInstalled;
  }

  /** Managed sessions end with the agent; give their final events a moment to be acknowledged. */
  async stop(): Promise<void> {
    this.discovery.stop();
    await this.managed.stopAll();
    const deadline = Date.now() + 2000;
    while (this.outbox.size && this.link.isOpen && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    await this.ingest.stop();
    this.link.stop();
  }
}
