import { agentProduct } from '@pocket-agent/core';
import {
  attachmentLimit,
  CONFIGURE_AGENT_VERSION,
  ConfigureSessionRequest,
  isWithinFolder,
  RESUME_ANY_FOLDER_AGENT_VERSION,
  RESUME_FILES_AGENT_VERSION,
  RESUME_MIN_AGENT_VERSION,
  ResumeSessionRequest,
  SendInstructionRequest,
  SessionCapabilities,
  SessionControlRequest,
  StartSessionRequest,
  providerAgentVersion,
  resumeAgentVersion,
  ProviderId,
  OtherAgent,
  versionBelow,
  type AttachmentRef,
  type CommandKind,
  type TurnEffort,
  type TurnMode,
} from '@pocket-agent/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { markUsed, ownedAttachments } from '../attachments/service.js';
import {
  createCommand,
  toCommandDto,
  withdrawCommand,
  type CreateCommandInput,
  type Services,
} from '../commands/service.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit } from '../context.js';

const IdParam = z.object({ id: z.uuid() });
const Projects = z.array(z.object({ path: z.string() }));

function bad(reply: FastifyReply, error: string, message: string, code = 409) {
  return reply.code(code).send({ error, message });
}

/** Parses the body with `schema`, or answers 400 with what is wrong (then returns null). */
function parseBody<S extends z.ZodType>(
  req: FastifyRequest,
  reply: FastifyReply,
  schema: S,
): z.infer<S> | null {
  const body = schema.safeParse(req.body);
  if (body.success) return body.data;
  bad(reply, 'invalid_request', body.error.issues[0]?.message ?? 'Invalid request', 400);
  return null;
}

/** Whether `path` is inside one of the folders the PC allows (its project list). */
function allowedFolder(projects: unknown, path: string): boolean {
  const list = Projects.safeParse(projects);
  return list.success && list.data.some((x) => isWithinFolder(path, x.path));
}

/** Answers "update Pocket Agent on the PC" when the PC is older than `version` (then returns true). */
function outdated(reply: FastifyReply, agentVersion: string, version: string, what: string, code = 400) {
  if (!versionBelow(agentVersion, version)) return false;
  bad(
    reply,
    'agent_outdated',
    `${what} needs Pocket Agent ${version} or newer on the PC. Run \`pocket-agent update\` there.`,
    code,
  );
  return true;
}

/** Only what was chosen: an unset model, mode or effort leaves the session's own. */
function turnChoices(b: {
  model?: string | undefined;
  permissionMode?: TurnMode | undefined;
  effort?: TurnEffort | undefined;
}) {
  return {
    ...(b.model ? { model: b.model } : {}),
    ...(b.permissionMode ? { permissionMode: b.permissionMode } : {}),
    ...(b.effort ? { effort: b.effort } : {}),
  };
}

/** What a command to a running session may carry (each route's schema allows a part of it). */
type SessionCommandBody = {
  idempotencyKey: string;
  text?: string | undefined;
  model?: string | undefined;
  permissionMode?: TurnMode | undefined;
  effort?: TurnEffort | undefined;
  attachmentIds?: string[] | undefined;
};

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

  /** The model must be one this PC reported; the PC checks again. Answers 400 when it isn't. */
  function unknownModel(
    reply: FastifyReply,
    device: { models: unknown },
    model: string | undefined,
  ): boolean {
    if (!model) return false;
    const list = z.array(z.object({ id: z.string() })).safeParse(device.models);
    if (list.success && list.data.some((m) => m.id === model)) return false;
    bad(reply, 'model_not_available', 'That model is not available on this PC.', 400);
    return true;
  }

  /**
   * Another agent than Claude Code: only one the PC reported installed and signed in, with one of
   * its own models. False (and the reply sent) when it can't be used.
   */
  function otherAgentReady(
    reply: FastifyReply,
    device: { agents: unknown },
    other: Exclude<ProviderId, 'claude-code'>,
    model: string | undefined,
  ): boolean {
    const agent = z
      .array(OtherAgent)
      .catch([])
      .parse(device.agents ?? [])
      .find((a) => a.provider === other);
    const name = agentProduct(other);
    if (!agent) bad(reply, 'provider_not_available', `${name} isn’t installed on this PC.`, 400);
    else if (!agent.signedIn) bad(reply, 'provider_signed_out', `Sign in to ${name} on this PC first.`, 400);
    else if (model && agent.models.length && !agent.models.some((m) => m.id === model))
      bad(reply, 'model_not_available', 'That model is not available on this PC.', 400);
    else return true;
    return false;
  }

  /**
   * Files sent with a message: the user's own, fully uploaded, as many as the PC takes. With
   * `needs`, only from that PC agent version (files with the message that starts a session).
   * Answers the error and returns null when they can't be sent.
   */
  async function sentFiles(
    req: FastifyRequest,
    reply: FastifyReply,
    agentVersion: string,
    ids: string[] | undefined,
    needs?: { version: string; what: string },
  ): Promise<AttachmentRef[] | undefined | null> {
    if (!ids?.length) return undefined;
    if (needs && outdated(reply, agentVersion, needs.version, needs.what)) return null;
    const max = attachmentLimit(agentVersion);
    if (ids.length > max) {
      bad(
        reply,
        'too_many_files',
        `Pocket Agent on this PC takes at most ${max} files per message. Update it on the PC: \`pocket-agent update\``,
        400,
      );
      return null;
    }
    const attachments = await ownedAttachments(ctx, req.user!.id, ids);
    if (!attachments) {
      bad(reply, 'attachment_not_found', 'An attached file is missing. Attach it again.', 400);
      return null;
    }
    return attachments;
  }

  /** Creates the command (idempotent per key): 201, or 200 for a retry of one already made. */
  async function issue(
    req: FastifyRequest,
    reply: FastifyReply,
    input: Omit<CreateCommandInput, 'userId' | 'ip'>,
  ) {
    const { command, created } = await createCommand(ctx, { ...input, userId: req.user!.id, ip: req.ip });
    // Sent with a message: kept (not swept as an upload nobody sent).
    if (input.attachments?.length)
      await markUsed(
        ctx,
        input.attachments.map((a) => a.id),
      );
    return reply.code(created ? 201 : 200).send({ command: toCommandDto(command) });
  }

  /** A command to a running session: what it can take was reported by its PC. */
  async function sessionCommand(
    req: FastifyRequest,
    reply: FastifyReply,
    kind: Exclude<CommandKind, 'session.start'>,
    schema: z.ZodType<SessionCommandBody>,
  ) {
    const s = await ownedSession(req, reply);
    if (!s) return;
    const body = parseBody(req, reply, schema);
    if (!body) return;
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
    if (kind === 'session.configure') {
      // A session started in the editor keeps the editor's settings; a mode or model chosen here
      // still goes with the next message sent from here.
      if (s.mode !== 'managed')
        return bad(
          reply,
          'not_supported',
          'This session runs in your editor with its own settings. Your choice applies to the next message you send from here.',
        );
      if (outdated(reply, s.device.agentVersion, CONFIGURE_AGENT_VERSION, 'Switching mode mid-task', 409))
        return;
    }
    // The model list is Claude Code's: another agent checks its own models on the PC.
    if (s.provider === 'claude-code' && unknownModel(reply, s.device, body.model)) return;
    const attachments = await sentFiles(req, reply, s.device.agentVersion, body.attachmentIds);
    if (attachments === null) return;
    return issue(req, reply, {
      deviceId: s.deviceId,
      session: { id: s.id, externalSessionId: s.externalSessionId },
      kind,
      idempotencyKey: body.idempotencyKey,
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...turnChoices(body),
      ...(attachments ? { attachments } : {}),
    });
  }

  /** Takes back a message Claude hasn't started on (to edit it): it leaves the chat. */
  app.post('/commands/:id/withdraw', opts, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const r = await withdrawCommand(ctx, req.user!.id, p.data.id);
    if (!r.ok) return bad(reply, r.error, r.message, r.status);
    return { command: toCommandDto(r.command) };
  });

  app.post('/sessions/:id/instructions', opts, (req, reply) =>
    sessionCommand(req, reply, 'instruction', SendInstructionRequest),
  );
  app.post('/sessions/:id/interrupt', opts, (req, reply) =>
    sessionCommand(req, reply, 'interrupt', SessionControlRequest),
  );
  app.post('/sessions/:id/stop', opts, (req, reply) =>
    sessionCommand(req, reply, 'session.stop', SessionControlRequest),
  );
  /** A new mode or model for a running session, applied at once (mid-turn too). */
  app.post('/sessions/:id/configure', opts, (req, reply) =>
    sessionCommand(req, reply, 'session.configure', ConfigureSessionRequest),
  );

  app.post('/devices/:id/sessions', opts, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const device = await ctx.prisma.device.findFirst({ where: { id: p.data.id, userId: req.user!.id } });
    if (!device) return reply.code(404).send({ error: 'not_found' });
    if (device.revokedAt) return bad(reply, 'device_revoked', 'This device was revoked.');
    const body = parseBody(req, reply, StartSessionRequest);
    if (!body) return;
    if (!allowedFolder(device.projects, body.projectPath)) {
      return bad(
        reply,
        'project_not_allowed',
        'That folder is not on this PC’s project list. Add it on the PC with `pocket-agent projects add <folder>`.',
        400,
      );
    }
    // Another agent than Claude Code: only PCs that know to start it (older ones would start Claude).
    const other = body.provider && body.provider !== 'claude-code' ? body.provider : undefined;
    if (
      other &&
      outdated(
        reply,
        device.agentVersion,
        providerAgentVersion(other),
        `Chatting with ${agentProduct(other)}`,
        409,
      )
    )
      return;
    if (other) {
      if (!otherAgentReady(reply, device, other, body.model)) return;
    } else if (unknownModel(reply, device, body.model)) return;
    const attachments = await sentFiles(req, reply, device.agentVersion, body.attachmentIds, {
      version: RESUME_FILES_AGENT_VERSION,
      what: 'Sending files when starting a chat',
    });
    if (attachments === null) return;
    return issue(req, reply, {
      deviceId: device.id,
      session: null,
      kind: 'session.start',
      ...(other ? { provider: other } : {}),
      idempotencyKey: body.idempotencyKey,
      text: body.text,
      projectPath: body.projectPath,
      ...turnChoices(body),
      ...(attachments ? { attachments } : {}),
    });
  });

  /**
   * Continue an ended session: the PC reopens the same conversation (same session id, full
   * history) as a session controlled from the app, and runs `text` as its next message.
   */
  app.post('/sessions/:id/resume', opts, async (req, reply) => {
    const s = await ownedSession(req, reply);
    if (!s) return;
    const body = parseBody(req, reply, ResumeSessionRequest);
    if (!body) return;
    if (!s.endedAt) return bad(reply, 'session_running', 'This session is still running. Send it a message.');
    if (s.device.revokedAt) return bad(reply, 'device_revoked', 'This device was revoked.');
    // Another agent's chat continues on PCs that know how, with that agent still signed in.
    const provider = ProviderId.safeParse(s.provider);
    if (!provider.success) return bad(reply, 'not_supported', 'This chat can’t be continued from here.');
    const other = provider.data === 'claude-code' ? undefined : provider.data;
    if (
      other &&
      outdated(
        reply,
        s.device.agentVersion,
        resumeAgentVersion(other),
        `Continuing a ${agentProduct(other)} chat`,
        409,
      )
    )
      return;
    if (outdated(reply, s.device.agentVersion, RESUME_MIN_AGENT_VERSION, 'Continuing a session', 409)) return;
    // From 0.1.5 the PC continues the session in the folder its conversation ran in, whatever the
    // project list says (that list is for starting new chats). Older agents still require it.
    if (
      versionBelow(s.device.agentVersion, RESUME_ANY_FOLDER_AGENT_VERSION) &&
      !allowedFolder(s.device.projects, s.projectPath)
    ) {
      return bad(
        reply,
        'project_not_allowed',
        'This session’s folder is not on the PC’s project list. Add it on the PC with `pocket-agent projects add <folder>`.',
        400,
      );
    }
    if (other) {
      if (!otherAgentReady(reply, s.device, other, body.model)) return;
    } else if (unknownModel(reply, s.device, body.model)) return;
    const attachments = await sentFiles(req, reply, s.device.agentVersion, body.attachmentIds, {
      version: RESUME_FILES_AGENT_VERSION,
      what: 'Sending files when continuing a session',
    });
    if (attachments === null) return;
    return issue(req, reply, {
      deviceId: s.deviceId,
      session: { id: s.id, externalSessionId: s.externalSessionId },
      kind: 'session.start',
      ...(other ? { provider: other } : {}),
      resume: true,
      idempotencyKey: body.idempotencyKey,
      text: body.text,
      projectPath: s.projectPath,
      ...turnChoices(body),
      ...(attachments ? { attachments } : {}),
    });
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
