import { z } from 'zod';
import { ApprovalStatus } from './enums.js';

const iso = z.iso.datetime({ offset: true });

export const ApprovalDto = z.object({
  id: z.string(),
  sessionId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  projectName: z.string(),
  sessionMode: z.enum(['managed', 'observed']),
  requestId: z.string(),
  toolName: z.string(),
  /** Allow-listed summary of the tool input, as sent by the PC (JSON text). */
  input: z.string(),
  status: ApprovalStatus,
  /** Set as soon as someone decides; status becomes Approved/Denied once the PC applied it. */
  decision: z.enum(['allow', 'deny']).nullable(),
  decisionMessage: z.string().nullable(),
  createdAt: iso,
  expiresAt: iso,
  decidedAt: iso.nullable(),
});
export type ApprovalDto = z.infer<typeof ApprovalDto>;

export const ApprovalListResponse = z.object({ approvals: z.array(ApprovalDto) });
export type ApprovalListResponse = z.infer<typeof ApprovalListResponse>;

export const ApprovalResponse = z.object({ approval: ApprovalDto });
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;

/**
 * The user's answers to Claude's question (AskUserQuestion only): question text → the chosen option
 * label(s), comma-separated for multi-select, or the user's own words.
 */
export const QuestionAnswers = z
  .record(z.string().min(1).max(500), z.string().trim().min(1).max(500))
  .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 4, 'Answer 1 to 4 questions');
export type QuestionAnswers = z.infer<typeof QuestionAnswers>;

export const DecideApprovalRequest = z.object({
  decision: z.enum(['allow', 'deny']),
  /** Shown to Claude when denying. */
  message: z.string().trim().max(500).optional(),
  /** Only with `allow` on an AskUserQuestion request: the answers Claude receives. */
  answers: QuestionAnswers.optional(),
});
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequest>;

/** How long the PC holds a request for a remote decision before falling back. */
export const APPROVAL_WAIT_MS = {
  /** Managed sessions: no human at the PC; on timeout the request is denied. */
  managed: 10 * 60 * 1000,
  /** Sessions the user started: bounded by the hook timeout; on timeout Claude Code asks locally. */
  observed: 5 * 60 * 1000,
} as const;
