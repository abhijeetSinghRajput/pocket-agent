import { createEvent, type Platform } from '@pocket-agent/protocol';
import path from 'node:path';
import { ApprovalBroker } from './approvals.js';
import { CommandRouter, type FullAck } from './command-router.js';
import { isHelperSession } from './providers/claude-code/helper-sessions.js';
import { listFolders } from './folders.js';
import { IngestServer } from './ingest-server.js';
import { AgentLink, type LinkEvents } from './link.js';
import { Outbox } from './outbox.js';
import { loadPolicy, type Policy } from './policy.js';
import { ClaudeDiscovery } from './providers/claude-code/discovery.js';
import { ClaudeHookHandler } from './providers/claude-code/hooks.js';
import {
  claudeConfigDir,
  defaultSettingsPath,
  hooksStatus,
  installedCommand,
  installHooks,
} from './providers/claude-code/install.js';
import { ObservedInstructions } from './providers/claude-code/instructions.js';
import { ManagedSessions, type QueryFn } from './providers/claude-code/managed.js';
import { IdleWake } from './providers/claude-code/wake.js';
import { listModels } from './providers/claude-code/models.js';
import { AttachmentClient, safeFileName } from './attachments.js';
import { readSubagents } from './providers/claude-code/subagents.js';
import type { ClaudeUsage, ModelOption, OtherAgent } from '@pocket-agent/protocol';
import { detectCodex } from './providers/codex/detect.js';
import { spawnAppServer, type Transport } from './providers/codex/rpc.js';
import { CodexSessions } from './providers/codex/sessions.js';
import { readUsage } from './providers/claude-code/usage.js';
import os from 'node:os';
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
  /** Read Claude Code's model list after start (default true; tests turn it off). */
  loadModels?: boolean;
  /** How Codex's app-server is started (tests pass a fake). */
  codex?: () => Transport;
}

/**
 * The running Local Agent: backend link + reliable outbox + session registry + Claude Code
 * integration (hooks, discovery, managed sessions) + remote commands + the local endpoint.
 */
export class AgentService {
  readonly outbox = new Outbox<SessionEventOut>();
  readonly registry: SessionRegistry;
  readonly managed: ManagedSessions;
  /** Chats with Codex run from the app. */
  readonly codex: CodexSessions;
  readonly observed: ObservedInstructions;
  readonly wake: IdleWake;
  readonly link: AgentLink;
  readonly ingest: IngestServer;
  private readonly hooks: ClaudeHookHandler;
  private readonly discovery: ClaudeDiscovery;
  private readonly router: CommandRouter;
  private hooksInstalled = false;
  private policy: Policy = {
    projects: [],
    observedInstructions: false,
    shareAttachments: false,
    remoteApproval: false,
  };
  /** Set from the dashboard (config.update), on by default. Only matters for sessions the user started. */
  private awayMode = true;
  /** Models Claude Code offers on this PC (read once after start). */
  private models: ModelOption[] = [];
  readonly approvals = new ApprovalBroker();
  private expiryTimer: NodeJS.Timeout | null = null;
  private usageTimer: NodeJS.Timeout | null = null;
  /** Claude plan usage of the account on this PC (null = not available). */
  private usage: ClaudeUsage | null = null;
  /** Other coding agents found on this PC (Codex), re-checked every few minutes. */
  private agents: OtherAgent[] = [];
  private agentsTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: ServiceOptions) {
    this.registry = new SessionRegistry((e) => this.enqueue(e));
    // Command status reports travel through the same reliable outbox as session events.
    const ack: FullAck = (commandId, status, extra = {}) =>
      this.enqueue(createEvent('command.ack', { commandId, status, ...extra }));
    this.managed = new ManagedSessions(this.registry, opts.query, opts.log, ack, Date.now, {
      broker: this.approvals,
      enabled: () => this.policy.remoteApproval,
    });
    this.managed.filesRoot = path.join(opts.home, 'attachments');
    this.codex = new CodexSessions(
      this.registry,
      opts.codex ?? spawnAppServer,
      opts.agentVersion,
      opts.log,
      ack,
      Date.now,
      { broker: this.approvals, enabled: () => this.policy.remoteApproval },
    );
    this.observed = new ObservedInstructions(this.registry, ack);
    this.wake = new IdleWake(this.registry, opts.query, ack, opts.log, Date.now, {
      broker: this.approvals,
      enabled: () => this.policy.remoteApproval,
    });
    this.wake.filesRoot = this.managed.filesRoot;
    const attachments = new AttachmentClient({
      apiUrl: opts.apiUrl,
      deviceId: opts.deviceId,
      secret: opts.secret,
      home: opts.home,
    });
    this.hooks = new ClaudeHookHandler(this.registry, this.managed.isManaged, {
      shareFilesAllowed: () => this.policy.shareAttachments,
      shareFiles: async (files) => {
        const refs = [];
        for (const [i, f] of files.entries()) {
          try {
            refs.push(await attachments.upload(f, safeFileName(`attachment-${i + 1}`, f.mime)));
          } catch (err) {
            opts.log('warn', `could not share an attached file: ${(err as Error).message}`);
          }
        }
        return refs;
      },
      instructions: this.observed,
      instructionsAllowed: () => this.policy.observedInstructions,
      // Idle sessions are woken whenever phone messages are allowed (no separate switch).
      wakeIdleAllowed: () => this.policy.observedInstructions,
      wake: this.wake,
      approvals: this.approvals,
      remoteApprovalAllowed: () => this.policy.remoteApproval,
      holdForRemote: () => this.policy.remoteApproval && this.awayMode,
    });
    // A woken turn was reported from the SDK stream; the transcript reader skips over it.
    this.wake.onTurnEnd = (id) => this.hooks.transcripts.skipToEnd(id);
    const claudeDir = opts.claudeDir ?? claudeConfigDir();
    this.discovery = new ClaudeDiscovery(path.join(claudeDir, 'sessions'), this.registry, {
      // Neither the app's own sessions nor the agent's short helper sessions are "discovered".
      isManaged: (id) => this.managed.isManaged(id) || isHelperSession(id),
      hooksInstalled: () => this.hooksInstalled,
      ...(opts.discoveryIntervalMs ? { intervalMs: opts.discoveryIntervalMs } : {}),
    });
    this.router = new CommandRouter({
      registry: this.registry,
      managed: this.managed,
      observed: this.observed,
      wake: this.wake,
      models: () => this.models,
      // Codex runs only where it is installed and signed in (else: provider_not_available).
      others: { codex: this.codex },
      attachments,
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
      reloadPolicy: (focus) => this.reloadPolicy(focus),
      status: () => ({ connected: this.link.isOpen, version: opts.agentVersion }),
    });

    this.link.on('connected', () => this.flush());
    this.link.on('message', (msg) => {
      if (msg.eventType === 'ack') this.outbox.ack(msg.payload.ackEventId);
      if (msg.eventType === 'command.execute') void this.router.handle(msg);
      if (msg.eventType === 'folder.list') {
        // Answered straight away and never stored: a lost answer is just asked again.
        const { requestId, path: folder } = msg.payload;
        void listFolders(this.policy, folder).then((r) =>
          this.link.send(createEvent('folder.listed', { requestId, ...r })),
        );
      }
      if (msg.eventType === 'command.withdraw') {
        // Take a waiting message back (to edit it in the app), wherever it waits.
        const { requestId, commandId } = msg.payload;
        const withdrawn =
          this.managed.withdraw(commandId) ||
          this.codex.withdraw(commandId) ||
          this.observed.withdraw(commandId) ||
          this.wake.withdraw(commandId);
        this.link.send(createEvent('command.withdrawn', { requestId, withdrawn }));
      }
      if (msg.eventType === 'agents.read') {
        // A session's sub-agents and one's transcript, for the app's agent map. Read from disk on
        // each ask, never stored.
        const { requestId, toolUseId } = msg.payload;
        void readSubagents(msg.sessionId ?? '', toolUseId)
          .catch(() => ({ error: 'unreadable' }))
          .then((r) => this.link.send(createEvent('agents.read.result', { requestId, ...r })));
      }
      if (msg.eventType === 'config.update' && msg.payload.awayMode !== this.awayMode) {
        this.awayMode = msg.payload.awayMode;
        opts.log(
          'info',
          `Away mode ${this.awayMode ? 'ON' : 'off'}${this.awayMode && !this.policy.remoteApproval ? ' (has no effect: remote approval is off on this PC)' : ''}`,
        );
      }
      if (msg.eventType === 'approval.decision') {
        const p = msg.payload;
        const applied = this.approvals.decide(
          p.requestId,
          p.decision === 'allow'
            ? {
                behavior: 'allow',
                ...(p.answers ? { answers: p.answers } : {}),
                ...(p.remember ? { remember: true } : {}),
              }
            : { behavior: 'deny', message: p.message ?? 'Denied in Pocket Agent' },
        );
        // "stale": nothing was waiting any more (answered on the PC / timed out) — never applied.
        this.enqueue(
          createEvent('approval.decision.ack', {
            approvalId: p.approvalId,
            result: applied ? 'applied' : 'stale',
          }),
        );
      }
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
      remoteApproval: this.policy.remoteApproval,
      models: this.models,
      usage: this.usage,
      // For the app's health check: is Claude Code linked to this PC.
      health: { hooks: this.hooksInstalled },
      agents: this.agents,
    });
  }

  /** Reads the Claude plan usage and tells the backend when it changed (the app's profile page). */
  private async loadUsage(): Promise<void> {
    const usage = await readUsage(this.opts.query, os.homedir());
    const same =
      JSON.stringify({ ...usage, updatedAt: 0 }) === JSON.stringify({ ...this.usage, updatedAt: 0 });
    this.usage = usage;
    if (!same) this.link.send(this.settingsEvent());
  }

  /** Is Codex here and signed in, with which models; tells the backend when that changed. */
  private async loadAgents(): Promise<void> {
    const codex = await detectCodex(this.opts.codex ?? spawnAppServer, this.opts.agentVersion, this.opts.log);
    const agents = codex ? [codex] : [];
    if (JSON.stringify(agents) === JSON.stringify(this.agents)) return;
    this.agents = agents;
    this.link.send(this.settingsEvent());
  }

  /** Asks Claude Code which models it offers, then tells the backend (the app's model picker). */
  private async loadModels(): Promise<void> {
    const models = await listModels(this.opts.query, os.homedir());
    if (!models.length) return this.opts.log('warn', 'Could not read the model list from Claude Code');
    this.models = models;
    this.link.send(this.settingsEvent());
  }

  /** After (re)connecting: replay everything unacknowledged, in order, then policy and state. */
  private flush(): void {
    for (const e of this.outbox.pending()) this.link.send(e);
    this.link.send(this.settingsEvent());
    this.link.send(this.registry.snapshot());
  }

  /** Re-reads policy.json (after `pocket-agent projects …` / `instructions …`) and tells the backend. */
  async reloadPolicy(focus?: string): Promise<void> {
    this.policy = await loadPolicy(this.opts.home);
    this.hooks.refreshCapabilities();
    this.managed.refreshCapabilities();
    const settings = this.settingsEvent();
    // The folder just added on the PC (or already allowed): the phone goes to it. Only once.
    this.link.send(
      focus ? { ...settings, payload: { ...settings.payload, focus: { path: focus } } } : settings,
    );
  }

  async start(): Promise<void> {
    const settings = this.opts.claudeDir
      ? path.join(this.opts.claudeDir, 'settings.json')
      : defaultSettingsPath();
    const hooks = await hooksStatus(settings);
    this.hooksInstalled = hooks.installed;
    if (hooks.outdated) {
      // Installed by an older version: refresh our own entries (same command; others untouched).
      const command = await installedCommand(settings);
      if (command)
        await installHooks(settings, command)
          .then(() => this.opts.log('info', 'Updated the Pocket Agent hooks in Claude Code settings'))
          .catch((err: Error) => this.opts.log('warn', `could not update the hooks: ${err.message}`));
    }
    this.policy = await loadPolicy(this.opts.home);
    await this.ingest.start();
    this.discovery.start();
    this.expiryTimer = setInterval(() => this.observed.expire(), 5_000);
    this.link.start();
    if (this.opts.loadModels !== false) {
      void this.loadModels().then(() => this.loadUsage());
      this.usageTimer = setInterval(() => void this.loadUsage(), 5 * 60_000);
      // Codex installed or signed in later shows up within a few minutes.
      void this.loadAgents();
      this.agentsTimer = setInterval(() => void this.loadAgents(), 5 * 60_000);
    }
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
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.agentsTimer) clearInterval(this.agentsTimer);
    this.approvals.cancelAll();
    this.wake.stopAll();
    await this.managed.stopAll();
    await this.codex.stopAll().catch(() => undefined);
    const deadline = Date.now() + 2000;
    while (this.outbox.size && this.link.isOpen && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    await this.ingest.stop();
    this.link.stop();
  }
}
