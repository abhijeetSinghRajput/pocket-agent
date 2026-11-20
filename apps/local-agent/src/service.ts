import { createEvent, type Platform } from '@agentdock/protocol';
import path from 'node:path';
import { CommandRouter, type FullAck } from './command-router.js';
import { IngestServer } from './ingest-server.js';
import { AgentLink, type LinkEvents } from './link.js';
import { Outbox } from './outbox.js';
import { loadPolicy, type Policy } from './policy.js';
import { ClaudeDiscovery } from './providers/claude-code/discovery.js';
import { ClaudeHookHandler } from './providers/claude-code/hooks.js';
import { claudeConfigDir, defaultSettingsPath, hooksStatus } from './providers/claude-code/install.js';
import { ObservedInstructions } from './providers/claude-code/instructions.js';
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
 * The running Local Agent: backend link + reliable outbox + session registry + Claude Code
 * integration (hooks, discovery, managed sessions) + remote commands + the local endpoint.
 */
export class AgentService {
  readonly outbox = new Outbox<SessionEventOut>();
  readonly registry: SessionRegistry;
  readonly managed: ManagedSessions;
  readonly observed: ObservedInstructions;
  readonly link: AgentLink;
  readonly ingest: IngestServer;
  private readonly hooks: ClaudeHookHandler;
  private readonly discovery: ClaudeDiscovery;
  private readonly router: CommandRouter;
  private hooksInstalled = false;
  private policy: Policy = { projects: [], observedInstructions: false };
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ServiceOptions) {
    this.registry = new SessionRegistry((e) => this.enqueue(e));
    // Command status reports travel through the same reliable outbox as session events.
    const ack: FullAck = (commandId, status, extra = {}) =>
      this.enqueue(createEvent('command.ack', { commandId, status, ...extra }));
    this.managed = new ManagedSessions(this.registry, opts.query, opts.log, ack);
    this.observed = new ObservedInstructions(this.registry, ack);
    this.hooks = new ClaudeHookHandler(this.registry, this.managed.isManaged, {
      instructions: this.observed,
      instructionsAllowed: () => this.policy.observedInstructions,
    });
    const claudeDir = opts.claudeDir ?? claudeConfigDir();
    this.discovery = new ClaudeDiscovery(path.join(claudeDir, 'sessions'), this.registry, {
      isManaged: this.managed.isManaged,
      hooksInstalled: () => this.hooksInstalled,
      ...(opts.discoveryIntervalMs ? { intervalMs: opts.discoveryIntervalMs } : {}),
    });
    this.router = new CommandRouter({
      registry: this.registry,
      managed: this.managed,
      observed: this.observed,
      policy: () => this.policy,
      ack,
      log: opts.log,
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
      reloadPolicy: () => this.reloadPolicy(),
    });

    this.link.on('connected', () => this.flush());
    this.link.on('message', (msg) => {
      if (msg.eventType === 'ack') this.outbox.ack(msg.payload.ackEventId);
      if (msg.eventType === 'command.execute') void this.router.handle(msg);
    });
  }

  private enqueue(event: SessionEventOut): void {
    this.outbox.push(event);
    this.link.send(event);
  }

  private settingsEvent() {
    return createEvent('device.settings', {
      projects: this.policy.projects.slice(0, 50),
      observedInstructions: this.policy.observedInstructions,
    });
  }

  /** After (re)connecting: replay everything unacknowledged, in order, then policy and state. */
  private flush(): void {
    for (const e of this.outbox.pending()) this.link.send(e);
    this.link.send(this.settingsEvent());
    this.link.send(this.registry.snapshot());
  }

  /** Re-reads policy.json (after `agentdock projects …` / `instructions …`) and tells the backend. */
  async reloadPolicy(): Promise<void> {
    this.policy = await loadPolicy(this.opts.home);
    this.hooks.refreshCapabilities();
    this.link.send(this.settingsEvent());
  }

  async start(): Promise<void> {
    const settings = this.opts.claudeDir
      ? path.join(this.opts.claudeDir, 'settings.json')
      : defaultSettingsPath();
    this.hooksInstalled = (await hooksStatus(settings)).installed;
    this.policy = await loadPolicy(this.opts.home);
    await this.ingest.start();
    this.discovery.start();
    this.expiryTimer = setInterval(() => this.observed.expire(), 5_000);
    this.link.start();
  }

  get hooksAreInstalled(): boolean {
    return this.hooksInstalled;
  }

  get currentPolicy(): Policy {
    return this.policy;
  }

  /** Managed sessions end with the agent; give their final events a moment to be acknowledged. */
  async stop(): Promise<void> {
    this.discovery.stop();
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    await this.managed.stopAll();
    const deadline = Date.now() + 2000;
    while (this.outbox.size && this.link.isOpen && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    await this.ingest.stop();
    this.link.stop();
  }
}
