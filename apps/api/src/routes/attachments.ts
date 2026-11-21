import { CompleteAttachmentRequest, SignAttachmentRequest } from '@pocket-agent/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AttachmentError,
  completeAttachment,
  discardAttachment,
  fileUrl,
  removeExpiredAttachments,
  signAttachment,
  type AttachmentServices,
  type Owner,
} from '../attachments/service.js';
import { authenticateDevice } from '../auth/device-auth.js';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit } from '../context.js';

const IdParam = z.object({ id: z.uuid() });

/**
 * Photos and PDFs sent with messages. The file goes straight from the browser (or the PC) to
 * storage with an upload this API signed; the API then verifies it and hands out short-lived links
 * to its owner only. The same routes exist for the browser (session cookie) and for the user's PC
 * (device credentials): the PC fetches what the app sent, and uploads what was attached in the editor.
 */
export async function attachmentRoutes(app: FastifyInstance, ctx: AttachmentServices): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof AttachmentError)
      return reply.code(err.status).send({ error: err.code, message: err.message });
    throw err;
  };

  /** The PC's identity for the /agent routes, or undefined after answering 401. */
  async function device(req: FastifyRequest, reply: FastifyReply): Promise<Owner | undefined> {
    const auth = await authenticateDevice(ctx, req.headers.authorization);
    if (!auth.ok) {
      void reply.code(401).send({ error: auth.reason === 'revoked' ? 'device_revoked' : 'unauthorized' });
      return undefined;
    }
    return { userId: auth.device.userId, deviceId: auth.device.id };
  }

  async function sign(owner: Owner, req: FastifyRequest, reply: FastifyReply) {
    const body = SignAttachmentRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Attach a photo (PNG, JPEG, WebP, GIF) or a PDF of at most 10 MB.',
      });
    }
    try {
      return reply.code(201).send(await signAttachment(ctx, owner, body.data));
    } catch (err) {
      return fail(reply, err);
    }
  }

  async function complete(owner: Owner, req: FastifyRequest, reply: FastifyReply) {
    const p = IdParam.safeParse(req.params);
    const body = CompleteAttachmentRequest.safeParse(req.body);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      return { attachment: await completeAttachment(ctx, owner, p.data.id, body.data) };
    } catch (err) {
      return fail(reply, err);
    }
  }

  async function file(userId: string, req: FastifyRequest, reply: FastifyReply) {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    try {
      // The link is short-lived and must not be cached or leaked through a Referer.
      return reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .redirect(await fileUrl(ctx, userId, p.data.id), 302);
    } catch (err) {
      return fail(reply, err);
    }
  }

  // ── Browser ────────────────────────────────────────────────────────────────
  const write = { preHandler: [trusted, user], config: limit(ctx, 30) };
  app.post('/attachments/sign', write, (req, reply) => sign({ userId: req.user!.id }, req, reply));
  app.post('/attachments/:id/complete', write, (req, reply) =>
    complete({ userId: req.user!.id }, req, reply),
  );
  app.get('/attachments/:id/file', { preHandler: user, config: limit(ctx, 120) }, (req, reply) =>
    file(req.user!.id, req, reply),
  );

  /** Taken out of the message box before sending: the upload is deleted right away. */
  app.delete('/attachments/:id', write, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    await discardAttachment(ctx, req.user!.id, p.data.id);
    return reply.code(204).send();
  });

  /** For the app: the short-lived link as JSON, so it can say why a removed file can't be opened. */
  app.get('/attachments/:id/link', { preHandler: user, config: limit(ctx, 120) }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    try {
      return reply
        .header('cache-control', 'no-store')
        .send({ url: await fileUrl(ctx, req.user!.id, p.data.id) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** The small preview kept in our database: still there after the file itself was removed. */
  app.get('/attachments/:id/thumb', { preHandler: user }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });
    const a = await ctx.prisma.attachment.findFirst({
      where: { id: p.data.id, userId: req.user!.id, readyAt: { not: null } },
      select: { thumb: true },
    });
    if (!a?.thumb) return reply.code(404).send({ error: 'not_found' });
    return (
      reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('x-content-type-options', 'nosniff')
        // Shown by the web app, which may be on another port/subdomain of the same site (never another site).
        .header('cross-origin-resource-policy', 'same-site')
        .send(Buffer.from(a.thumb))
    );
  });

  // ── The user's PC ──────────────────────────────────────────────────────────
  const pc = { config: limit(ctx, 60) };
  app.post('/agent/attachments/sign', pc, async (req, reply) => {
    const owner = await device(req, reply);
    return owner ? sign(owner, req, reply) : reply;
  });
  app.post('/agent/attachments/:id/complete', pc, async (req, reply) => {
    const owner = await device(req, reply);
    return owner ? complete(owner, req, reply) : reply;
  });
  app.get('/agent/attachments/:id/file', pc, async (req, reply) => {
    const owner = await device(req, reply);
    return owner ? file(owner.userId, req, reply) : reply;
  });

  // ── Retention: files leave storage after 30 days ───────────────────────────
  const run = () =>
    removeExpiredAttachments(ctx)
      .then((n) => n && app.log.info({ removed: n }, 'removed expired attachment files'))
      .catch((err: unknown) => app.log.warn({ err }, 'attachment retention failed'));
  const first = setTimeout(run, 90_000);
  const timer = setInterval(run, 15 * 60 * 1000);
  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}
