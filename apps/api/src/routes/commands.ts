import {
  SendInstructionRequest,
  SessionCapabilities,
  SessionControlRequest,
  StartSessionRequest,
  type AttachmentRef,
  type CommandKind,
} from '@pocket-agent/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { markUsed, ownedAttachments } from '../attachments/service.js';
import { createCommand, toCommandDto, type Services } from '../commands/service.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit } from '../context.js';

const IdParam = z.object({ id: z.uuid() });

function bad(reply: FastifyReply, error: string, message: string, code = 409) {
  return reply.code(code).send({ error, message });
}

/** Remote control of sessions. Every check here is repeated on the PC, which has the final say. */
export async function commandRoutes(app: FastifyInstance, ctx: Services): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);
  const opts = { preHandler: [trusted, user], config: limit(ctx, 30) };

  /** Loads an open session owned by the user (404 otherwise, including other users' sessions). */
  async function ownedSession(req: FastifyRequest, reply: FastifyReply) {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return void reply.code(404).send({ error: 'not_found' });
    const s = await ctx.prisma.agentSession.findFirst({
      where: { id: p.data.id, device: { userId: req.user!.id } },
      include: { device: true },
    });
    if (!s) return void reply.code(404).send({ error: 'not_found' });
    return s;
  }

  /** The model must be one this PC reported; the PC checks again. */
  function knownModel(device: { models: unknown }, model: string | undefined): boolean {
    if (!model) return true;
    const list = z.array(z.object({ id: z.string() })).safeParse(device.models);
    return list.success && list.data.some((m) => m.id === model);
  }
  const unknownModel = (reply: FastifyReply) =>
    bad(reply, 'model_not_available', 'That model is not available on this PC.', 400);

  async function sessionCommand(
    req: FastifyRequest,
    reply: FastifyReply,
    kind: CommandKind,
    text?: string,
    model?: string,
    attachmentIds?: string[],
  ) {
    const s = await ownedSession(req, reply);
    if (!s) return;
    if (s.endedAt) return bad(reply, 'session_ended', 'This session has ended.');
    if (s.device.revokedAt) return bad(reply, 'device_revoked', 'This device was revoked.');
    const caps = SessionCapabilities.safeParse(s.capabilities);
    const c = caps.success ? caps.data : null;
    if (kind === 'instruction' && !(c?.instructAnytime || c?.instructBetweenTurns)) {
      return bad(
        reply,
        'not_supported',
        s.mode === 'observed'
          ? 'Instructions to sessions you start yourself are turned off on this PC. Run `pocket-agent instructions enable` on the PC to allow them.'
          : 'This session cannot receive instructions.',
      );
    }
    if ((kind === 'interrupt' || kind === 'session.stop') && !c?.interrupt) {
      return bad(
        reply,
        'not_supported',
        s.mode === 'observed'
          ? 'Stopping sessions you start yourself is turned off on this PC. Run `pocket-agent instructions enable` on the PC to allow it.'
          : 'This session cannot be stopped remotely.',
      );
    }
    if (!knownModel(s.device, model)) return unknownModel(reply);
    // Only the user's own, fully uploaded files that still exist.
    let attachments: AttachmentRef[] | undefined;
    if (attachmentIds?.length) {
      attachments = await ownedAttachments(ctx, req.user!.id, attachmentIds);
      if (!attachments)
        return bad(reply, 'attachment_not_found', 'An attached file is missing. Attach it again.', 400);
    }
    const key = (kind === 'instruction' ? SendInstructionRequest : SessionControlRequest).safeParse(req.body);
    if (!key.success)
      return bad(reply, 'invalid_request', key.error.issues[0]?.message ?? 'Invalid request', 400);
    const { command, created } = await createCommand(ctx, {
      userId: req.user!.id,
      deviceId: s.deviceId,
      session: { id: s.id, externalSessionId: s.externalSessionId },
      kind,
      idempotencyKey: key.data.idempotencyKey,
      ...(text !== undefined ? { text } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(attachments ? { attachments } : {}),
      ip: req.ip,
    });
    if (attachments)
      await markUsed(
        ctx,
        attachments.map((a) => a.id),
      );
    return reply.code(created ? 201 : 200).send({ command: toCommandDto(command) });
  }

  app.post('/sessions/:id/instructions', opts, async (req, reply) => {
    const body = SendInstructionRequest.safeParse(req.body);
    if (!body.success)
      return bad(reply, 'invalid_request', body.error.issues[0]?.message ?? 'Invalid request', 400);
    return sessionCommand(
      req,
      reply,
      'instruction',
      body.data.text,
      body.data.model,
      body.data.attachmentIds,
    );
  });
  app.post('/sessions/:id/interrupt', opts, (req, reply) => sessionCommand(req, reply, 'interrupt'));
  app.post('/sessions/:id/stop', opts, (req, reply) => sessionCommand(req, reply, 'session.stop'));

  app.post('/devices/:id/sessions', opts, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const device = await ctx.prisma.device.findFirst({ where: { id: p.data.id, userId: req.user!.id } });
    if (!device) return reply.code(404).send({ error: 'not_found' });
    if (device.revokedAt) return bad(reply, 'device_revoked', 'This device was revoked.');
    const body = StartSessionRequest.safeParse(req.body);
    if (!body.success)
      return bad(reply, 'invalid_request', body.error.issues[0]?.message ?? 'Invalid request', 400);
    const projects = z.array(z.object({ path: z.string() })).safeParse(device.projects);
    if (!projects.success || !projects.data.some((x) => x.path === body.data.projectPath)) {
      return bad(
        reply,
        'project_not_allowed',
        'That folder is not on this PC’s project list. Add it on the PC with `pocket-agent projects add <folder>`.',
        400,
      );
    }
    if (!knownModel(device, body.data.model)) return unknownModel(reply);
    const { command, created } = await createCommand(ctx, {
      userId: req.user!.id,
      deviceId: device.id,
      session: null,
      kind: 'session.start',
      idempotencyKey: body.data.idempotencyKey,
      text: body.data.text,
      projectPath: body.data.projectPath,
      ...(body.data.model ? { model: body.data.model } : {}),
      ip: req.ip,
    });
    return reply.code(created ? 201 : 200).send({ command: toCommandDto(command) });
  });

  app.get('/sessions/:id/commands', { preHandler: user }, async (req, reply) => {
    const s = await ownedSession(req, reply);
    if (!s) return;
    const commands = await ctx.prisma.command.findMany({
      where: { sessionId: s.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { commands: commands.map(toCommandDto) };
  });

  app.get('/commands/:id', { preHandler: user }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const c = await ctx.prisma.command.findFirst({ where: { id: p.data.id, userId: req.user!.id } });
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { command: toCommandDto(c) };
  });
}
