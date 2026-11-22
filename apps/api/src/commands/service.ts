import {
  AttachmentRefs,
  BackendToAgent,
  COMMAND_TRANSITIONS,
  COMMAND_TTL_MS,
  createEvent,
  type AttachmentRef,
  type CommandDto,
  type TurnEffort,
  type TurnMode,
  type CommandKind,
  type CommandStatus,
} from '@pocket-agent/protocol';
import { redisKey, type AppContext } from '../context.js';
import { Prisma, type Command } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { CHANNELS, notifyUser, type Bus } from '../realtime/bus.js';

export type Services = AppContext & { bus: Bus };

interface CommandPayload {
  text?: string;
  projectPath?: string;
  model?: string;
  permissionMode?: TurnMode;
  effort?: TurnEffort;
  attachments?: AttachmentRef[];
  /** session.start: continue the command's session instead of starting a new one. */
  resume?: boolean;
}

export function toCommandDto(c: Command): CommandDto {
  const p = (c.payload ?? {}) as CommandPayload;
  return {
    id: c.id,
    deviceId: c.deviceId,
    sessionId: c.sessionId,
    commandType: c.commandType as CommandKind,
    text: p.text ?? null,
    projectPath: p.projectPath ?? null,
    model: p.model ?? null,
    permissionMode: p.permissionMode ?? null,
    effort: p.effort ?? null,
    attachments: AttachmentRefs.catch([]).parse(p.attachments ?? []),
    status: c.status,
    error: c.error,
    createdAt: c.createdAt.toISOString(),
    deliveredAt: c.deliveredAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    expiresAt: c.expiresAt.toISOString(),
  };
}

/** True if `to` is reachable from `from` by moving forward through the command state machine. */
export function canAdvance(from: CommandStatus, to: CommandStatus): boolean {
  const seen = new Set<CommandStatus>([from]);
  const queue: CommandStatus[] = [from];
  while (queue.length) {
    const s = queue.shift()!;
    for (const n of COMMAND_TRANSITIONS[s]) {
      if (n === to) return true;
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

const isTerminal = (s: CommandStatus) => COMMAND_TRANSITIONS[s].length === 0;

async function notifyCommand(ctx: Services, c: Command): Promise<void> {
  await notifyUser(
    ctx.bus,
    c.userId,
    createEvent(
      'command.status.changed',
      { commandId: c.id, status: c.status },
      { deviceId: c.deviceId, ...(c.sessionId ? { sessionId: c.sessionId } : {}) },
    ),
  );
}

/** Builds the frame the PC receives. Session-scoped commands name their session in the envelope. */
export function commandFrame(c: Command, externalSessionId: string | null) {
  const p = (c.payload ?? {}) as CommandPayload;
  const base = { commandId: c.id, expiresAt: c.expiresAt.toISOString() };
  const model = {
    ...(p.model ? { model: p.model } : {}),
    ...(p.permissionMode ? { permissionMode: p.permissionMode } : {}),
    ...(p.effort ? { effort: p.effort } : {}),
  };
  const payload =
    c.commandType === 'instruction'
      ? {
          ...base,
          ...model,
          ...(p.attachments?.length ? { attachments: p.attachments } : {}),
          commandType: 'instruction' as const,
          text: p.text!,
        }
      : c.commandType === 'session.start'
        ? {
            ...base,
            ...model,
            commandType: 'session.start' as const,
            projectPath: p.projectPath!,
            text: p.text!,
            ...(p.resume ? { resume: true } : {}),
          }
        : { ...base, commandType: c.commandType as 'interrupt' | 'session.stop' };
  return BackendToAgent.parse(
    createEvent('command.execute', payload, {
      deviceId: c.deviceId,
      ...(externalSessionId ? { sessionId: externalSessionId } : {}),
    }),
  );
}

/** Hands the command to whichever API instance holds the device's connection. */
export async function dispatch(ctx: Services, c: Command, externalSessionId: string | null): Promise<void> {
  await ctx.bus.publish(
    CHANNELS.agentCommands,
    JSON.stringify({ deviceId: c.deviceId, frame: commandFrame(c, externalSessionId) }),
  );
}

export interface CreateCommandInput {
  userId: string;
  deviceId: string;
  session: { id: string; externalSessionId: string } | null;
  kind: CommandKind;
  idempotencyKey: string;
  text?: string;
  projectPath?: string;
  model?: string;
  permissionMode?: TurnMode;
  effort?: TurnEffort;
  attachments?: AttachmentRef[];
  /** session.start of an ended session (`session`) that the PC continues. */
  resume?: boolean;
  ip?: string;
}

/**
 * Creates a command (idempotent per user + key) and sends it to the PC. If the PC is not
 * connected the command fails immediately with `device_offline` — it is never queued to run
 * later by surprise.
 */
export async function createCommand(
  ctx: Services,
  input: CreateCommandInput,
): Promise<{ command: Command; created: boolean }> {
  const existing = await ctx.prisma.command.findUnique({
    where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return { command: existing, created: false };

  const device = await ctx.prisma.device.findUniqueOrThrow({ where: { id: input.deviceId } });
  const online =
    !device.revokedAt &&
    device.status === 'Online' &&
    (await ctx.redis.exists(redisKey(ctx, 'presence', device.id)).catch(() => 0)) === 1;

  const now = ctx.now();
  let command: Command;
  try {
    command = await ctx.prisma.command.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId,
        sessionId: input.session?.id ?? null,
        commandType: input.kind,
        payload: {
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.projectPath !== undefined ? { projectPath: input.projectPath } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
          ...(input.effort !== undefined ? { effort: input.effort } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          ...(input.resume ? { resume: true } : {}),
        },
        idempotencyKey: input.idempotencyKey,
        status: online ? 'Pending' : 'Failed',
        ...(online ? {} : { error: 'device_offline', completedAt: now }),
        expiresAt: new Date(now.getTime() + COMMAND_TTL_MS[input.kind]),
      },
    });
  } catch (err) {
    // Concurrent retry with the same key.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await ctx.prisma.command.findUniqueOrThrow({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      });
      return { command: again, created: false };
    }
    throw err;
  }

  await audit(ctx.prisma, {
    userId: input.userId,
    actorType: 'user',
    actorId: input.userId,
    action: 'command.created',
    targetType: 'command',
    targetId: command.id,
    // Never the instruction text itself in the audit trail; its size and target are enough.
    metadata: {
      kind: input.kind,
      deviceId: input.deviceId,
      sessionId: input.session?.id ?? null,
      characters: input.text?.length ?? 0,
      // A mode chosen in the app changes how Claude Code asks for permission: always on record.
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      outcome: online ? 'sent' : 'device_offline',
    },
    ip: input.ip ?? null,
  });

  if (online) await dispatch(ctx, command, input.session?.externalSessionId ?? null);
  await notifyCommand(ctx, command);
  return { command, created: true };
}

/**
 * Applies a status report from the PC. Status only moves forward; terminal states are final.
 * A session.start that succeeded links the command to the session the PC created.
 */
export async function applyCommandAck(
  ctx: Services,
  device: { id: string },
  ack: { commandId: string; status: CommandStatus; error?: string; externalSessionId?: string },
): Promise<void> {
  const c = await ctx.prisma.command.findUnique({ where: { id: ack.commandId } });
  if (!c || c.deviceId !== device.id) return; // not this device's command: ignore
  if (c.status === ack.status || !canAdvance(c.status, ack.status)) return;

  const now = ctx.now();
  const data: Prisma.CommandUncheckedUpdateManyInput = { status: ack.status };
  // Any report from the PC proves delivery.
  if (!c.deliveredAt && ack.status !== 'Expired') data.deliveredAt = now;
  if (isTerminal(ack.status)) data.completedAt = now;
  if (ack.error) data.error = ack.error.slice(0, 500);
  if (ack.externalSessionId && !c.sessionId) {
    const s = await ctx.prisma.agentSession.findUnique({
      where: {
        deviceId_externalSessionId: { deviceId: device.id, externalSessionId: ack.externalSessionId },
      },
      select: { id: true },
    });
    if (s) data.sessionId = s.id;
  }
  // Conditional on the status we read: a concurrent ack can't move it backwards.
  const r = await ctx.prisma.command.updateMany({ where: { id: c.id, status: c.status }, data });
  if (!r.count) return;
  await notifyCommand(ctx, await ctx.prisma.command.findUniqueOrThrow({ where: { id: c.id } }));
}

/**
 * Commands still waiting when their time is up never run. An instruction the PC already has
 * (Delivered / Accepted: queued behind Claude's current task) is the exception: it waits for as
 * long as that task takes, and the PC reports when it runs, or fails if the session ends first.
 */
export async function expireCommands(ctx: Services): Promise<number> {
  const due = await ctx.prisma.command.findMany({
    where: {
      expiresAt: { lt: ctx.now() },
      OR: [
        { status: 'Pending' },
        { status: { in: ['Delivered', 'Accepted'] }, commandType: { not: 'instruction' } },
      ],
    },
    take: 500,
  });
  let n = 0;
  for (const c of due) {
    const r = await ctx.prisma.command.updateMany({
      where: { id: c.id, status: c.status },
      data: { status: 'Expired', completedAt: ctx.now(), error: c.error ?? 'expired' },
    });
    if (r.count) {
      n++;
      await notifyCommand(ctx, { ...c, status: 'Expired' });
    }
  }
  return n;
}

/** Re-sends commands that never reached the PC (e.g. it reconnected right after they were created). */
export async function resendPending(ctx: Services, deviceId: string): Promise<void> {
  const pending = await ctx.prisma.command.findMany({
    where: { deviceId, status: 'Pending', expiresAt: { gt: ctx.now() } },
    include: { session: { select: { externalSessionId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const c of pending) await dispatch(ctx, c, c.session?.externalSessionId ?? null);
}
