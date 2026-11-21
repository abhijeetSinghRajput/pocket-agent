import { BackendToAgent, createEvent, type ApprovalDto, type ApprovalStatus } from '@pocket-agent/protocol';
import { redisKey } from '../context.js';
import type { Approval, AgentSession, Device, Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { CHANNELS, notifyUser } from '../realtime/bus.js';
import type { Services } from '../commands/service.js';

type Db = Prisma.TransactionClient | Services['prisma'];
export type ApprovalRow = Approval & {
  session: Pick<AgentSession, 'projectName' | 'mode'>;
  device: Pick<Device, 'name'>;
};
export const approvalInclude = {
  session: { select: { projectName: true, mode: true } },
  device: { select: { name: true } },
} as const;

export function toApprovalDto(a: ApprovalRow): ApprovalDto {
  const payload = (a.requestPayload ?? {}) as { input?: unknown };
  return {
    id: a.id,
    sessionId: a.sessionId,
    deviceId: a.deviceId,
    deviceName: a.device.name,
    projectName: a.session.projectName,
    sessionMode: a.session.mode,
    requestId: a.requestId,
    toolName: a.toolName,
    input: typeof payload.input === 'string' ? payload.input : '{}',
    status: a.status,
    decision: a.decision === 'allow' || a.decision === 'deny' ? a.decision : null,
    decisionMessage: a.decisionMessage,
    createdAt: a.createdAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
  };
}

async function notifyApproval(ctx: Services, a: Approval, kind: 'approval.created' | 'approval.updated') {
  const extra = { deviceId: a.deviceId, sessionId: a.sessionId };
  await notifyUser(
    ctx.bus,
    a.userId,
    kind === 'approval.created'
      ? createEvent('approval.created', { approvalId: a.id }, extra)
      : createEvent('approval.updated', { approvalId: a.id, status: a.status }, extra),
  );
}

/**
 * The PC holds a permission request for a decision from Pocket Agent. Called inside the event-ingest
 * transaction. Idempotent per (session, requestId).
 */
export async function openApproval(
  tx: Db,
  input: {
    userId: string;
    deviceId: string;
    sessionId: string;
    requestId: string;
    toolName: string;
    inputSummary: string;
    expiresAt: Date;
  },
): Promise<Approval | null> {
  const existing = await tx.approval.findUnique({
    where: { sessionId_requestId: { sessionId: input.sessionId, requestId: input.requestId } },
  });
  if (existing) return null;
  return tx.approval.create({
    data: {
      userId: input.userId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      toolName: input.toolName.slice(0, 200),
      requestPayload: { input: input.inputSummary },
      expiresAt: input.expiresAt,
    },
  });
}

/** The PC resolved the request itself (answered on the PC, timed out, cancelled). */
export async function closeApprovalFromPc(
  tx: Db,
  sessionId: string,
  requestId: string,
  outcome: 'remote' | 'local' | 'auto_denied' | 'timeout' | 'cancelled',
): Promise<Approval | null> {
  if (outcome === 'remote') return null; // the decision ack settles it
  const status: ApprovalStatus = outcome === 'timeout' ? 'Expired' : 'Cancelled';
  const a = await tx.approval.findUnique({ where: { sessionId_requestId: { sessionId, requestId } } });
  if (!a || a.status !== 'Pending') return null;
  const r = await tx.approval.updateMany({ where: { id: a.id, status: 'Pending' }, data: { status } });
  return r.count ? { ...a, status } : null;
}

export class DecisionError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'already_decided'
      | 'expired'
      | 'not_pending'
      | 'device_offline'
      | 'answers_not_supported'
      | 'invalid_answers',
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/**
 * Records a decision exactly once (compare-and-set on Pending + no decision + not expired), then
 * sends it to the PC. The approval only becomes Approved/Denied when the PC confirms it applied
 * the decision; a decision that arrives too late becomes Cancelled — never "Approved".
 */
/** The question texts in an AskUserQuestion request's stored input summary. */
function askedQuestions(inputSummary: string): string[] {
  try {
    const q = (JSON.parse(inputSummary) as { questions?: unknown }).questions;
    if (!Array.isArray(q)) return [];
    return q
      .map((x) => (x && typeof x === 'object' ? (x as { question?: unknown }).question : undefined))
      .filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

export async function decideApproval(
  ctx: Services,
  input: {
    userId: string;
    approvalId: string;
    decision: 'allow' | 'deny';
    message?: string;
    /** Answers to Claude's question; only accepted for an AskUserQuestion request. */
    answers?: Record<string, string>;
    ip?: string;
  },
): Promise<ApprovalRow> {
  const a = await ctx.prisma.approval.findFirst({
    where: { id: input.approvalId, userId: input.userId },
    include: { ...approvalInclude, device: true, session: true },
  });
  if (!a) throw new DecisionError('not_found', 'Not found', 404);
  if (a.decision) throw new DecisionError('already_decided', 'This request was already answered.');
  if (a.status !== 'Pending')
    throw new DecisionError('not_pending', 'This request is no longer waiting for a decision.');

  // Answers exist for one tool only, and only for the questions Claude actually asked.
  const answers = input.decision === 'allow' ? input.answers : undefined;
  if (answers) {
    if (a.toolName !== 'AskUserQuestion')
      throw new DecisionError('answers_not_supported', 'Only a question from Claude can be answered.', 400);
    const stored = (a.requestPayload ?? {}) as { input?: unknown };
    const asked = askedQuestions(typeof stored.input === 'string' ? stored.input : '{}');
    const given = Object.keys(answers);
    if (!asked.length || given.length !== asked.length || !given.every((q) => asked.includes(q)))
      throw new DecisionError('invalid_answers', 'Answer every question Claude asked.', 400);
  }

  const now = ctx.now();
  if (a.expiresAt <= now) {
    await ctx.prisma.approval.updateMany({
      where: { id: a.id, status: 'Pending' },
      data: { status: 'Expired' },
    });
    throw new DecisionError('expired', 'This request expired; Claude Code handled it on the PC.');
  }
  const online =
    !a.device.revokedAt &&
    a.device.status === 'Online' &&
    (await ctx.redis.exists(redisKey(ctx, 'presence', a.deviceId)).catch(() => 0)) === 1;
  // Don't consume the decision if it can't reach the PC; the request stays answerable.
  if (!online)
    throw new DecisionError('device_offline', 'Your PC is offline, so the decision cannot reach it.');

  const message = input.decision === 'deny' ? input.message?.trim() || 'Denied in Pocket Agent' : null;
  const r = await ctx.prisma.approval.updateMany({
    where: { id: a.id, status: 'Pending', decision: null, expiresAt: { gt: now } },
    data: {
      decision: input.decision,
      decisionMessage: message,
      decidedByUserId: input.userId,
      decidedAt: now,
    },
  });
  if (!r.count) throw new DecisionError('already_decided', 'This request was already answered.');

  await audit(ctx.prisma, {
    userId: input.userId,
    actorType: 'user',
    actorId: input.userId,
    action: 'approval.decided',
    targetType: 'approval',
    targetId: a.id,
    metadata: {
      decision: input.decision,
      toolName: a.toolName,
      // That the question was answered here, not what was answered.
      ...(answers ? { answered: Object.keys(answers).length } : {}),
      sessionId: a.sessionId,
      deviceId: a.deviceId,
    },
    ip: input.ip ?? null,
  });

  const frame = BackendToAgent.parse(
    createEvent(
      'approval.decision',
      {
        approvalId: a.id,
        requestId: a.requestId,
        decision: input.decision,
        ...(message ? { message } : {}),
        ...(answers ? { answers } : {}),
      },
      { deviceId: a.deviceId, sessionId: a.session.externalSessionId },
    ),
  );
  await ctx.bus.publish(CHANNELS.agentCommands, JSON.stringify({ deviceId: a.deviceId, frame }));

  const updated = await ctx.prisma.approval.findUniqueOrThrow({
    where: { id: a.id },
    include: approvalInclude,
  });
  await notifyApproval(ctx, updated, 'approval.updated');
  return updated;
}

/** The PC reports whether it applied the decision. */
export async function applyDecisionAck(
  ctx: Services,
  device: { id: string },
  ack: { approvalId: string; result: 'applied' | 'stale' },
): Promise<void> {
  const a = await ctx.prisma.approval.findUnique({ where: { id: ack.approvalId } });
  if (!a || a.deviceId !== device.id || a.status !== 'Pending' || !a.decision) return;
  const status: ApprovalStatus =
    ack.result === 'stale' ? 'Cancelled' : a.decision === 'allow' ? 'Approved' : 'Denied';
  const r = await ctx.prisma.approval.updateMany({
    where: { id: a.id, status: 'Pending' },
    data: { status },
  });
  if (r.count) {
    await audit(ctx.prisma, {
      userId: a.userId,
      actorType: 'device',
      actorId: device.id,
      action: 'approval.applied',
      targetType: 'approval',
      targetId: a.id,
      metadata: { result: ack.result, status },
    });
    await notifyApproval(ctx, { ...a, status }, 'approval.updated');
  }
}

export async function expireApprovals(ctx: Services): Promise<number> {
  const due = await ctx.prisma.approval.findMany({
    where: { status: 'Pending', expiresAt: { lt: ctx.now() } },
    take: 500,
  });
  let n = 0;
  for (const a of due) {
    const r = await ctx.prisma.approval.updateMany({
      where: { id: a.id, status: 'Pending' },
      data: { status: 'Expired' },
    });
    if (r.count) {
      n++;
      await notifyApproval(ctx, { ...a, status: 'Expired' }, 'approval.updated');
    }
  }
  return n;
}

export { notifyApproval };
