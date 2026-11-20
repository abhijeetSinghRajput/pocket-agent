import { MarkReadRequest, RegisterPushRequest, UpdateNotificationSettings } from '@pocket-agent/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit } from '../context.js';
import { loadSettings, notify, toNotificationDto, type NotifyServices } from '../notifications/service.js';

const PageQuery = z.object({
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function notificationRoutes(app: FastifyInstance, ctx: NotifyServices): Promise<void> {
  const user = requireUser(ctx);
  const trusted = requireTrustedOrigin(ctx);

  app.get('/notifications', { preHandler: user }, async (req, reply) => {
    const q = PageQuery.safeParse(req.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_request' });
    const userId = req.user!.id;
    const [rows, unread] = await Promise.all([
      ctx.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.data.limit,
        ...(q.data.before ? { cursor: { id: q.data.before }, skip: 1 } : {}),
      }),
      ctx.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      notifications: rows.map(toNotificationDto),
      nextCursor: rows.length === q.data.limit ? rows[rows.length - 1]!.id : null,
      unread,
    };
  });

  app.post('/notifications/read', { preHandler: [trusted, user] }, async (req, reply) => {
    const body = MarkReadRequest.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    await ctx.prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null, ...(body.data.ids ? { id: { in: body.data.ids } } : {}) },
      data: { readAt: ctx.now() },
    });
    return reply.code(204).send();
  });

  app.get('/notification-settings', { preHandler: user }, async (req) => loadSettings(ctx, req.user!.id));

  app.put('/notification-settings', { preHandler: [trusted, user] }, async (req, reply) => {
    const body = UpdateNotificationSettings.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: 'invalid_request', message: body.error.issues[0]?.message });
    const userId = req.user!.id;
    for (const [category, enabled] of Object.entries(body.data.categories ?? {})) {
      await ctx.prisma.notificationPreference.upsert({
        where: { userId_category: { userId, category } },
        create: { userId, category, enabled },
        update: { enabled },
      });
    }
    if (body.data.quietHours !== undefined) {
      const q = body.data.quietHours;
      if (q) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: q.timezone });
        } catch {
          return reply.code(400).send({ error: 'invalid_request', message: 'Unknown time zone' });
        }
      }
      const data = { quietStart: q?.start ?? null, quietEnd: q?.end ?? null, timezone: q?.timezone ?? 'UTC' };
      await ctx.prisma.notificationSettings.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    }
    return loadSettings(ctx, userId);
  });

  /** A browser registers for push. A token moving between accounts is re-assigned to the caller. */
  app.post(
    '/push/subscriptions',
    { preHandler: [trusted, user], config: limit(ctx, 20) },
    async (req, reply) => {
      const body = RegisterPushRequest.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
      const data = {
        userId: req.user!.id,
        platform: body.data.platform,
        userAgent: body.data.userAgent?.slice(0, 300) ?? null,
        lastError: null,
      };
      await ctx.prisma.pushSubscription.upsert({
        where: { token: body.data.token },
        create: { token: body.data.token, ...data },
        update: data,
      });
      return reply.code(204).send();
    },
  );

  app.post('/push/subscriptions/remove', { preHandler: [trusted, user] }, async (req, reply) => {
    const body = z.object({ token: z.string().min(1).max(4096) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    await ctx.prisma.pushSubscription.deleteMany({ where: { token: body.data.token, userId: req.user!.id } });
    return reply.code(204).send();
  });

  app.post('/notifications/test', { preHandler: [trusted, user], config: limit(ctx, 5) }, async (req) => {
    const n = await notify(ctx, {
      userId: req.user!.id,
      category: 'test',
      title: 'Pocket Agent test notification',
      body: 'If you can see this, notifications work on this device.',
      link: '/notifications',
      dedupeKey: `test:${crypto.randomUUID()}`,
    });
    return { notification: n ? toNotificationDto(n) : null };
  });
}
