import { z } from 'zod';
import { SessionCapabilities } from './capabilities.js';
import { defineEvent } from './envelope.js';
import {
  AgentStatus,
  ApprovalStatus,
  CommandStatus,
  DeviceStatus,
  Platform,
  ProviderId,
  SessionMode,
} from './enums.js';

/** Long tool inputs/outputs are truncated on the PC before they are sent (see architecture §7). */
export const MAX_TEXT_FIELD = 8 * 1024;
const text = z.string().max(MAX_TEXT_FIELD);
const id = z.string().min(1).max(200);

const SessionRef = z.object({
  provider: ProviderId,
  mode: SessionMode,
  externalSessionId: id,
  projectPath: z.string().max(1024),
  projectName: z.string().max(200),
});

const ToolCall = z.object({
  toolUseId: id,
  toolName: z.string().max(200),
  /** Allow-listed, truncated JSON of the tool input. */
  input: text,
});

// ───────────────────────────── Local Agent → Backend ─────────────────────────────

export const DeviceConnected = defineEvent(
  'device.connected',
  z.object({ agentVersion: z.string().max(50), platform: Platform, hostname: z.string().max(200) }),
);
export const DeviceHeartbeat = defineEvent(
  'device.heartbeat',
  z.object({ activeSessions: z.number().int().nonnegative() }),
);
export const AgentSessionStarted = defineEvent(
  'agent.session.started',
  SessionRef.extend({
    capabilities: SessionCapabilities,
    status: AgentStatus,
    /** Provider-specific, non-sensitive facts (e.g. entrypoint "claude-vscode", discovery source). */
    metadata: z.record(z.string().max(50), z.string().max(500)).optional(),
  }),
);
export const AgentSessionUpdated = defineEvent(
  'agent.session.updated',
  z.object({ externalSessionId: id, status: AgentStatus, currentTask: text.optional() }),
);
export const AgentSessionEnded = defineEvent(
  'agent.session.ended',
  z.object({ externalSessionId: id, reason: z.string().max(200) }),
);
export const AgentToolStarted = defineEvent('agent.tool.started', ToolCall);
export const AgentToolCompleted = defineEvent('agent.tool.completed', ToolCall.extend({ output: text }));
export const AgentToolFailed = defineEvent('agent.tool.failed', ToolCall.extend({ error: text }));
export const AgentPermissionRequested = defineEvent(
  'agent.permission.requested',
  ToolCall.extend({
    requestId: id,
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    /**
     * True when the PC is holding this request for a decision from AgentDock (PC opt-in, and Away
     * mode for sessions the user started). False/absent: informational only — it is answered on the PC.
     */
    awaitingRemote: z.boolean().optional(),
  }),
);
export const AgentPermissionResolved = defineEvent(
  'agent.permission.resolved',
  z.object({
    requestId: id,
    /**
     * remote = decided in AgentDock · local = answered on the PC · auto_denied = denied because no
     * approval channel was available (never auto-allowed) · timeout / cancelled.
     */
    outcome: z.enum(['remote', 'local', 'auto_denied', 'timeout', 'cancelled']),
  }),
);
export const AgentOutput = defineEvent(
  'agent.output',
  z.object({ role: z.enum(['assistant', 'user', 'system']), text }),
);
export const AgentError = defineEvent('agent.error', z.object({ message: text }));
/**
 * Sent after every (re)connect: the complete set of sessions the PC currently knows are live.
 * The backend restores their status and ends any other open session of this device.
 */
export const AgentSessionsSnapshot = defineEvent(
  'agent.sessions.snapshot',
  z.object({ sessions: z.array(z.object({ externalSessionId: id, status: AgentStatus })).max(500) }),
);
export const CommandAck = defineEvent(
  'command.ack',
  z.object({
    commandId: z.uuid(),
    status: CommandStatus,
    error: text.optional(),
    /** session.start: the id of the session that was created. */
    externalSessionId: id.optional(),
  }),
);
/**
 * PC-side policy, sent after every connect and whenever it changes. The PC enforces it; the
 * backend uses it only to show what is possible.
 */
export const DeviceSettings = defineEvent(
  'device.settings',
  z.object({
    /** Directories the PC owner allows managed sessions to be started in. */
    projects: z.array(z.object({ name: z.string().max(200), path: z.string().max(1024) })).max(50),
    /** Whether sessions the user starts themselves may receive instructions (between turns). */
    observedInstructions: z.boolean(),
    /** Whether permission requests may be decided remotely (PC opt-in, off by default). */
    remoteApproval: z.boolean().default(false),
  }),
);
export const ApprovalDecisionAck = defineEvent(
  'approval.decision.ack',
  z.object({ approvalId: z.uuid(), result: z.enum(['applied', 'stale']) }),
);

export const AgentToBackend = z.discriminatedUnion('eventType', [
  DeviceConnected,
  DeviceHeartbeat,
  AgentSessionStarted,
  AgentSessionUpdated,
  AgentSessionEnded,
  AgentToolStarted,
  AgentToolCompleted,
  AgentToolFailed,
  AgentPermissionRequested,
  AgentPermissionResolved,
  AgentOutput,
  AgentError,
  AgentSessionsSnapshot,
  CommandAck,
  DeviceSettings,
  ApprovalDecisionAck,
]);
export type AgentToBackend = z.infer<typeof AgentToBackend>;

/** Events that describe one session; their envelope must carry sessionId = externalSessionId. */
export const SESSION_SCOPED_EVENTS = new Set<AgentToBackend['eventType']>([
  'agent.session.started',
  'agent.session.updated',
  'agent.session.ended',
  'agent.tool.started',
  'agent.tool.completed',
  'agent.tool.failed',
  'agent.permission.requested',
  'agent.permission.resolved',
  'agent.output',
  'agent.error',
]);

// ───────────────────────────── Backend → Local Agent ─────────────────────────────

export const INSTRUCTION_MAX = 20_000;
const expiresAt = z.iso.datetime({ offset: true });

/**
 * A command for the PC. Session-scoped commands (instruction, interrupt, session.stop) carry the
 * target session in the envelope's sessionId (= externalSessionId). The PC drops commands past
 * expiresAt and never executes the same commandId twice.
 */
export const CommandExecute = defineEvent(
  'command.execute',
  z.discriminatedUnion('commandType', [
    z.object({
      commandId: z.uuid(),
      commandType: z.literal('instruction'),
      text: z.string().min(1).max(INSTRUCTION_MAX),
      expiresAt,
    }),
    z.object({
      commandId: z.uuid(),
      commandType: z.literal('session.start'),
      projectPath: z.string().max(1024),
      text: z.string().min(1).max(INSTRUCTION_MAX),
      expiresAt,
    }),
    z.object({ commandId: z.uuid(), commandType: z.literal('interrupt'), expiresAt }),
    z.object({ commandId: z.uuid(), commandType: z.literal('session.stop'), expiresAt }),
  ]),
);
export type CommandType = z.infer<typeof CommandExecute>['payload']['commandType'];
export const ApprovalDecision = defineEvent(
  'approval.decision',
  z.object({
    approvalId: z.uuid(),
    requestId: id,
    decision: z.enum(['allow', 'deny']),
    message: text.optional(),
  }),
);
export const DeviceRevoke = defineEvent('device.revoke', z.object({ reason: z.string().max(200) }));
export const ConfigUpdate = defineEvent(
  'config.update',
  /**
   * Away mode: the user is away from this PC, so permission requests of sessions they started
   * themselves wait for a decision from AgentDock (only if the PC allows remote approval).
   */
  z.object({ awayMode: z.boolean() }),
);
export const Ack = defineEvent('ack', z.object({ ackEventId: z.uuid() }));

export const BackendToAgent = z.discriminatedUnion('eventType', [
  CommandExecute,
  ApprovalDecision,
  DeviceRevoke,
  ConfigUpdate,
  Ack,
]);
export type BackendToAgent = z.infer<typeof BackendToAgent>;

// ───────────────────────────── Backend → Web ─────────────────────────────

export const DeviceStatusChanged = defineEvent(
  'device.status.changed',
  z.object({ status: DeviceStatus, lastHeartbeatAt: z.iso.datetime({ offset: true }).nullable() }),
);
export const AgentStatusChanged = defineEvent(
  'agent.status.changed',
  z.object({ status: AgentStatus, previous: AgentStatus.nullable().optional() }),
);
export const AgentEventCreated = defineEvent(
  'agent.event.created',
  z.object({ agentEventId: z.uuid(), eventType: z.string().max(100) }),
);
export const CommandStatusChanged = defineEvent(
  'command.status.changed',
  z.object({ commandId: z.uuid(), status: CommandStatus }),
);
export const ApprovalCreated = defineEvent('approval.created', z.object({ approvalId: z.uuid() }));
export const ApprovalUpdated = defineEvent(
  'approval.updated',
  z.object({ approvalId: z.uuid(), status: ApprovalStatus }),
);
export const NotificationCreated = defineEvent(
  'notification.created',
  z.object({ notificationId: z.uuid() }),
);

export const BackendToWeb = z.discriminatedUnion('eventType', [
  DeviceStatusChanged,
  AgentStatusChanged,
  AgentEventCreated,
  CommandStatusChanged,
  ApprovalCreated,
  ApprovalUpdated,
  NotificationCreated,
]);
export type BackendToWeb = z.infer<typeof BackendToWeb>;
