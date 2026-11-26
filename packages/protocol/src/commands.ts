import { z } from 'zod';
import { CommandStatus, ProviderId } from './enums.js';
import { ATTACHMENT_MAX_PER_MESSAGE, AttachmentRefs } from './attachments.js';
import { INSTRUCTION_MAX, ModelId, TurnEffort, TurnMode } from './events.js';

const iso = z.iso.datetime({ offset: true });

export const CommandKind = z.enum([
  'instruction',
  'session.start',
  'interrupt',
  'session.stop',
  // Mode or model of a running session, applied at once (PC agents from 0.1.8).
  'session.configure',
]);
export type CommandKind = z.infer<typeof CommandKind>;

export const CommandDto = z.object({
  id: z.string(),
  deviceId: z.string(),
  sessionId: z.string().nullable(),
  commandType: CommandKind,
  /** Instruction text (instruction / session.start). */
  text: z.string().nullable(),
  projectPath: z.string().nullable(),
  /** Model, mode and effort chosen for this turn, if any. */
  model: z.string().nullable().optional(),
  permissionMode: TurnMode.nullable().optional(),
  effort: TurnEffort.nullable().optional(),
  /** Files sent with the message. */
  attachments: AttachmentRefs.default([]),
  status: CommandStatus,
  error: z.string().nullable(),
  createdAt: iso,
  deliveredAt: iso.nullable(),
  completedAt: iso.nullable(),
  expiresAt: iso,
});
export type CommandDto = z.infer<typeof CommandDto>;

export const CommandResponse = z.object({ command: CommandDto });

/** First Local Agent version that can take back a message still waiting in its queue. */
export const WITHDRAW_AGENT_VERSION = '2.1.0';
/** The error of a message taken back to be edited: it leaves the chat. */
export const WITHDRAWN = 'withdrawn';
export type CommandResponse = z.infer<typeof CommandResponse>;

export const CommandListResponse = z.object({ commands: z.array(CommandDto) });
export type CommandListResponse = z.infer<typeof CommandListResponse>;

/** Client-generated idempotency key: retries with the same key never create a second command. */
const idempotencyKey = z.uuid();

export const SendInstructionRequest = z.object({
  text: z.string().trim().min(1, 'Type an instruction').max(INSTRUCTION_MAX),
  /** Model for this turn (one of the PC's models). Omit to keep the session's model. */
  model: ModelId.optional(),
  /** Mode and effort for this turn (turns Pocket Agent runs; a turn in the editor keeps its own). */
  permissionMode: TurnMode.optional(),
  effort: TurnEffort.optional(),
  /** Uploaded attachments to send with it (see /attachments/sign). */
  attachmentIds: z.array(z.uuid()).max(ATTACHMENT_MAX_PER_MESSAGE).optional(),
  idempotencyKey,
});
export type SendInstructionRequest = z.infer<typeof SendInstructionRequest>;

export const StartSessionRequest = z.object({
  /** The coding agent to chat with (absent: Claude Code). */
  provider: ProviderId.optional(),
  projectPath: z.string().min(1).max(1024),
  text: z.string().trim().min(1, 'Type the first instruction').max(INSTRUCTION_MAX),
  model: ModelId.optional(),
  permissionMode: TurnMode.optional(),
  effort: TurnEffort.optional(),
  /** Uploaded attachments to send with the first message (PC agents from 0.1.6). */
  attachmentIds: z.array(z.uuid()).max(ATTACHMENT_MAX_PER_MESSAGE).optional(),
  idempotencyKey,
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

/** Continue an ended session from the app: same conversation, reopened on the PC. */
export const ResumeSessionRequest = StartSessionRequest.omit({ projectPath: true });
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequest>;

/**
 * First Local Agent version that starts a chat with the coding agent asked for (and refuses one it
 * hasn't got). Older agents would start Claude Code whatever was asked, so the API never sends
 * them another provider.
 */
export const PROVIDERS_AGENT_VERSION = '2.5.0';

/**
 * First Local Agent version that knows Antigravity CLI (finds it, and refuses its chats safely
 * until it can run them). Older ones can't even read a command naming it.
 */
export const ANTIGRAVITY_AGENT_VERSION = '2.8.0';

/** First Local Agent version that knows OpenCode (its chats, approvals, continuing them). */
export const OPENCODE_AGENT_VERSION = '2.11.0';

/** First Local Agent version that knows GitHub Copilot CLI (its chats, approvals, continuing them). */
export const COPILOT_AGENT_VERSION = '2.12.0';

/** First Local Agent version that can start a chat with this agent (Claude Code: any). */
export function providerAgentVersion(provider: string): string {
  if (provider === 'copilot') return COPILOT_AGENT_VERSION;
  if (provider === 'opencode') return OPENCODE_AGENT_VERSION;
  return provider === 'antigravity'
    ? ANTIGRAVITY_AGENT_VERSION
    : provider === 'codex'
      ? PROVIDERS_AGENT_VERSION
      : '0.0.0';
}

/** First Local Agent version that applies a mode chosen for a Codex chat (Manual / Auto / Plan). */
export const CODEX_MODES_AGENT_VERSION = '2.7.0';

/** First Local Agent version that continues an ended Antigravity chat. */
export const ANTIGRAVITY_RESUME_AGENT_VERSION = '2.9.0';

/** First Local Agent version that continues an ended chat of this agent. */
export function resumeAgentVersion(provider: string): string {
  if (provider === 'copilot') return COPILOT_AGENT_VERSION;
  if (provider === 'opencode') return OPENCODE_AGENT_VERSION;
  return provider === 'antigravity'
    ? ANTIGRAVITY_RESUME_AGENT_VERSION
    : provider === 'codex'
      ? CODEX_RESUME_AGENT_VERSION
      : RESUME_MIN_AGENT_VERSION;
}

/** First Local Agent version that continues an ended Codex chat (Claude's: RESUME_MIN_AGENT_VERSION). */
export const CODEX_RESUME_AGENT_VERSION = '2.6.0';

/** First Local Agent version that can continue an ended session. */
export const RESUME_MIN_AGENT_VERSION = '0.1.4';

/**
 * From this Local Agent version an ended session continues in the folder its conversation ran in,
 * whatever the PC's project list says (the list is for starting new chats). Older agents still
 * require the folder to be on it.
 */
export const RESUME_ANY_FOLDER_AGENT_VERSION = '0.1.5';

/**
 * First Local Agent version that takes files with the message that starts a session (a new chat,
 * or the message that continues an ended one).
 */
export const RESUME_FILES_AGENT_VERSION = '0.1.6';

export const SessionControlRequest = z.object({ idempotencyKey });

/**
 * Change how a running session works, at once: its mode (how Claude asks before acting) or its
 * model. The turn that is running uses it from its next step.
 */
export const ConfigureSessionRequest = z
  .object({ permissionMode: TurnMode.optional(), model: ModelId.optional(), idempotencyKey })
  .refine((r) => r.permissionMode !== undefined || r.model !== undefined, {
    message: 'Choose a mode or a model',
  });
export type ConfigureSessionRequest = z.infer<typeof ConfigureSessionRequest>;

/** First Local Agent version that switches a running session's mode or model at once. */
export const CONFIGURE_AGENT_VERSION = '0.1.8';

/**
 * Session metadata key, "on" while the PC runs a session the user started in their editor on
 * Pocket Agent's behalf (a message sent from the app woke it): its mode and model switch at once,
 * mid-turn too, like a session Pocket Agent started. "off" (or absent) otherwise.
 */
export const LIVE_SETTINGS_METADATA = 'liveSettings';
export type SessionControlRequest = z.infer<typeof SessionControlRequest>;

/** How long a command may wait for the PC before it expires (never executed late). */
export const COMMAND_TTL_MS: Record<CommandKind, number> = {
  // Managed sessions take instructions at any time; a queued one may wait behind the current turn.
  instruction: 15 * 60 * 1000,
  'session.start': 2 * 60 * 1000,
  // A session the user started stops at Claude's next step, which can take a while.
  interrupt: 5 * 60 * 1000,
  'session.stop': 60 * 1000,
  'session.configure': 60 * 1000,
};

/** A folder path in one form for comparing: forward slashes, no trailing slash, Windows case-folded. */
function comparablePath(p: string): string {
  const slashes = p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows paths (a drive letter or a UNC share) don't care about case.
  return /^[a-z]:(\/|$)/i.test(slashes) || p.startsWith('\\\\') ? slashes.toLowerCase() : slashes;
}

/**
 * Whether `candidate` is `folder` itself or anywhere inside it. A folder allowed on the PC allows
 * everything under it. (`..` must already be resolved: the PC resolves paths before checking.)
 */
export function isWithinFolder(candidate: string, folder: string): boolean {
  const c = comparablePath(candidate);
  const f = comparablePath(folder);
  if (!f) return false;
  return c === f || c.startsWith(`${f}/`);
}
