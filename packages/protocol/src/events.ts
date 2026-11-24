import { z } from 'zod';
import { QuestionAnswers } from './approvals.js';
import { AttachmentRefs } from './attachments.js';
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

/** At most this many folders are listed when browsing a folder on the PC. */
export const FOLDER_LIST_MAX = 500;

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
     * True when the PC is holding this request for a decision from Pocket Agent (PC opt-in, and Away
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
     * remote = decided in Pocket Agent · local = answered on the PC · auto_denied = denied because no
     * approval channel was available (never auto-allowed) · timeout / cancelled.
     */
    outcome: z.enum(['remote', 'local', 'auto_denied', 'timeout', 'cancelled']),
  }),
);
export const AgentOutput = defineEvent(
  'agent.output',
  z.object({
    role: z.enum(['assistant', 'user', 'system']),
    text,
    /** Photos/PDFs the user attached to this message on the PC (uploaded by the PC, opt-in). */
    attachments: AttachmentRefs.optional(),
  }),
);
export const AgentError = defineEvent('agent.error', z.object({ message: text }));
/**
 * A worker Claude started in the session (a sub-agent or workflow, by its tool call) moved on: it
 * went to the background (`running`), or it ended. Background workers end after their tool call,
 * so this is how their end is known.
 */
export const AgentWorkerUpdated = defineEvent(
  'agent.worker.updated',
  z.object({
    toolUseId: id,
    status: z.enum(['running', 'done', 'failed', 'stopped']),
    summary: text.optional(),
  }),
);
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
/** Pattern of a model id or alias (e.g. "opus", "claude-sonnet-5-5"). */
export const ModelId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/);
/**
 * How Claude Code asks before acting, chosen in the app for a turn Pocket Agent runs. "Bypass
 * permissions" is never offered (approved constraint #3, as amended 2026-11-21).
 */
export const TurnMode = z.enum(['default', 'acceptEdits', 'plan', 'auto']);
export type TurnMode = z.infer<typeof TurnMode>;
/** How much Claude thinks before answering. */
export const TurnEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type TurnEffort = z.infer<typeof TurnEffort>;

/** One model the PC can run, as Claude Code describes it. */
export const ModelOption = z.object({
  id: ModelId,
  name: z.string().max(100),
  description: z.string().max(200).default(''),
});
export type ModelOption = z.infer<typeof ModelOption>;

/** One plan limit: how much of it is used, and when it resets. */
export const UsageWindow = z.object({
  percent: z.number().min(0).max(1000),
  resetsAt: z.iso.datetime({ offset: true }).nullable(),
});
/**
 * The Claude plan usage of the account signed in on the PC, as Claude Code's own /usage reports it.
 * Absent when the PC can't read it (API key sign-in, or an older Claude Code).
 */
export const ClaudeUsage = z.object({
  /** The 5-hour session limit. */
  session: UsageWindow.nullable(),
  /** The 7-day limit across all models. */
  weekly: UsageWindow.nullable(),
  /** 7-day limits of single models. */
  models: z.array(UsageWindow.extend({ name: z.string().min(1).max(60) })).max(8),
  /** The Claude plan, e.g. "Max 5x" (PC agents from 0.1.5). */
  plan: z.string().min(1).max(40).nullable().optional(),
  /**
   * When the PC's Claude sign-in ends for good (it then has to sign in again). Claude Code doesn't
   * share the subscription's renewal date, so this is the closest date there is.
   */
  loginExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ClaudeUsage = z.infer<typeof ClaudeUsage>;

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
    /** Models this PC's Claude Code offers (as it lists them itself). Empty until known. */
    models: z.array(ModelOption).max(40).default([]),
    /** Claude plan usage on this PC (refreshed every few minutes). */
    usage: ClaudeUsage.nullable().optional(),
  }),
);
/** The PC's answer to `folder.list`: the folders directly inside the one asked about. */
export const FolderListed = defineEvent(
  'folder.listed',
  z.object({
    requestId: z.uuid(),
    folders: z
      .array(z.object({ name: z.string().max(260), path: z.string().max(1024) }))
      .max(FOLDER_LIST_MAX)
      .default([]),
    /** More folders were there than were sent. */
    truncated: z.boolean().default(false),
    /** Why it could not be listed (e.g. project_not_allowed, folder_not_found). */
    error: z.string().max(100).optional(),
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
  AgentWorkerUpdated,
  AgentSessionsSnapshot,
  CommandAck,
  DeviceSettings,
  ApprovalDecisionAck,
  FolderListed,
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
  'agent.worker.updated',
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
      /** Model, mode and effort for this turn (only for turns Pocket Agent runs itself). */
      model: ModelId.optional(),
      permissionMode: TurnMode.optional(),
      effort: TurnEffort.optional(),
      /** Files sent with the message; the PC downloads them from the API. */
      attachments: AttachmentRefs.optional(),
      expiresAt,
    }),
    z.object({
      commandId: z.uuid(),
      commandType: z.literal('session.start'),
      projectPath: z.string().max(1024),
      text: z.string().min(1).max(INSTRUCTION_MAX),
      /**
       * Continue the ended session named in the envelope's sessionId (same id, full history)
       * instead of starting a new one.
       */
      resume: z.boolean().optional(),
      model: ModelId.optional(),
      permissionMode: TurnMode.optional(),
      effort: TurnEffort.optional(),
      /** Files sent with the first message (PC agents from 0.1.6; older ones drop the field). */
      attachments: AttachmentRefs.optional(),
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
    /** Answers to Claude's question (AskUserQuestion only; the PC ignores it for any other tool). */
    answers: QuestionAnswers.optional(),
  }),
);
export const DeviceRevoke = defineEvent('device.revoke', z.object({ reason: z.string().max(200) }));
export const ConfigUpdate = defineEvent(
  'config.update',
  /**
   * Away mode: the user is away from this PC, so permission requests of sessions they started
   * themselves wait for a decision from Pocket Agent (only if the PC allows remote approval).
   */
  z.object({ awayMode: z.boolean() }),
);
/**
 * Asks the PC which folders are directly inside `path` (one of its allowed projects, or a folder
 * inside one). Answered with `folder.listed`; nothing is stored, so it is never re-sent.
 */
export const FolderList = defineEvent(
  'folder.list',
  z.object({ requestId: z.uuid(), path: z.string().min(1).max(1024) }),
);
export const Ack = defineEvent('ack', z.object({ ackEventId: z.uuid() }));

export const BackendToAgent = z.discriminatedUnion('eventType', [
  CommandExecute,
  ApprovalDecision,
  DeviceRevoke,
  ConfigUpdate,
  FolderList,
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
