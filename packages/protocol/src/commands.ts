import { z } from 'zod';
import { CommandStatus } from './enums.js';
import { ATTACHMENT_MAX_PER_MESSAGE, AttachmentRefs } from './attachments.js';
import { INSTRUCTION_MAX, ModelId, TurnEffort, TurnMode } from './events.js';

const iso = z.iso.datetime({ offset: true });

export const CommandKind = z.enum(['instruction', 'session.start', 'interrupt', 'session.stop']);
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
  projectPath: z.string().min(1).max(1024),
  text: z.string().trim().min(1, 'Type the first instruction').max(INSTRUCTION_MAX),
  model: ModelId.optional(),
  permissionMode: TurnMode.optional(),
  effort: TurnEffort.optional(),
  idempotencyKey,
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

/** Continue an ended session from the app: same conversation, reopened on the PC. */
export const ResumeSessionRequest = StartSessionRequest.omit({ projectPath: true });
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequest>;

/** First Local Agent version that can continue an ended session. */
export const RESUME_MIN_AGENT_VERSION = '0.1.4';

export const SessionControlRequest = z.object({ idempotencyKey });
export type SessionControlRequest = z.infer<typeof SessionControlRequest>;

/** How long a command may wait for the PC before it expires (never executed late). */
export const COMMAND_TTL_MS: Record<CommandKind, number> = {
  // Managed sessions take instructions at any time; a queued one may wait behind the current turn.
  instruction: 15 * 60 * 1000,
  'session.start': 2 * 60 * 1000,
  // A session the user started stops at Claude's next step, which can take a while.
  interrupt: 5 * 60 * 1000,
  'session.stop': 60 * 1000,
};
