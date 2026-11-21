import { GoogleLoginRequest, LoginRequest, RegisterRequest } from '@pocket-agent/protocol';
import { GoogleTokenError, type GoogleVerifier } from '../auth/firebase.js';
import type { FastifyInstance } from 'fastify';
import {
  clearSessionCookie,
  requireTrustedOrigin,
  requireUser,
  startSession,
  toUserDto,
} from '../auth/session.js';
import { limit, redisKey, type AppContext } from '../context.js';
import { CHANNELS, type Bus } from '../realtime/bus.js';
import { audit } from '../lib/audit.js';
import { DUMMY_PASSWORD_HASH, hashPassword, sha256, verifyPassword } from '../lib/crypto.js';
import { Prisma } from '../generated/prisma/client.js';

/** Per-account brute-force protection, independent of the per-IP rate limit. */
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function authRoutes(
  app: FastifyInstance,
  ctx: AppContext & { bus: Bus; google?: GoogleVerifier | null },
): Promise<void> {
  const trusted = requireTrustedOrigin(ctx);
  const failKey = (email: string) => redisKey(ctx, 'login-fail', sha256(email));

  app.post('/auth/register', { preHandler: trusted, config: limit(ctx, 5) }, async (req, reply) => {
    if (!ctx.env.REGISTRATION_ENABLED) return reply.code(403).send({ error: 'registration_disabled' });
    const parsed = RegisterRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', message: parsed.error.issues[0]?.message });
    }
    const { name, email, password } = parsed.data;
    try {
      const user = await ctx.prisma.user.create({
        data: { name, email, passwordHash: await hashPassword(password) },
      });
      await audit(ctx.prisma, {
        userId: user.id,
        actorType: 'user',
        actorId: user.id,
        action: 'user.registered',
        targetType: 'user',
        targetId: user.id,
        ip: req.ip,
      });
      await startSession(ctx, req, reply, user.id);
      return reply.code(201).send({ user: toUserDto(user) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply
          .code(409)
          .send({ error: 'email_taken', message: 'An account with this email already exists' });
      }
      throw err;
    }
  });

  app.post('/auth/login', { preHandler: trusted, config: limit(ctx, 10) }, async (req, reply) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', message: parsed.error.issues[0]?.message });
    }
    const { email, password } = parsed.data;

    const failures = Number((await ctx.redis.get(failKey(email))) ?? 0);
    if (failures >= MAX_FAILED_LOGINS) {
      return reply.code(429).send({
        error: 'too_many_attempts',
        message: 'Too many failed sign-in attempts. Try again in 15 minutes.',
      });
    }

    const user = await ctx.prisma.user.findUnique({ where: { email } });
    // Always run Argon2 so response time doesn't reveal whether the account exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
      await ctx.redis.multi().incr(failKey(email)).pexpire(failKey(email), FAILED_LOGIN_WINDOW_MS).exec();
      if (user) {
        await audit(ctx.prisma, {
          userId: user.id,
          actorType: 'user',
          action: 'user.login_failed',
          targetType: 'user',
          targetId: user.id,
          ip: req.ip,
        });
      }
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Incorrect email or password' });
    }

    await ctx.redis.del(failKey(email));
    await startSession(ctx, req, reply, user.id);
    await audit(ctx.prisma, {
      userId: user.id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.login',
      targetType: 'user',
      targetId: user.id,
      ip: req.ip,
    });
    return { user: toUserDto(user) };
  });

  /**
   * Sign in with Google (Firebase Auth ID token). The same Google account always lands on the same
   * user; an existing account with that (Google-verified) email is linked on first use; otherwise a
   * new account is created if sign-ups are open.
   */
  app.post('/auth/google', { preHandler: trusted, config: limit(ctx, 10) }, async (req, reply) => {
    const verify = ctx.google;
    if (!verify) {
      return reply
        .code(404)
        .send({ error: 'google_login_disabled', message: 'Google sign-in is not set up here' });
    }
    const parsed = GoogleLoginRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    let id;
    try {
      id = await verify(parsed.data.idToken);
    } catch (err) {
      if (err instanceof GoogleTokenError) {
        req.log.warn({ reason: err.message }, 'google sign-in rejected');
        return reply
          .code(401)
          .send({ error: 'invalid_google_token', message: 'Google sign-in failed. Try again.' });
      }
      throw err;
    }

    let action: 'user.login' | 'user.google_linked' | 'user.registered' = 'user.login';
    let user = await ctx.prisma.user.findUnique({ where: { googleUid: id.uid } });
    if (!user) {
      const byEmail = await ctx.prisma.user.findUnique({ where: { email: id.email } });
      if (byEmail) {
        // Google verified this address, so it belongs to the same person: link it.
        user = await ctx.prisma.user.update({
          where: { id: byEmail.id },
          data: { googleUid: id.uid, avatarUrl: byEmail.avatarUrl ?? id.picture },
        });
        action = 'user.google_linked';
      } else {
        if (!ctx.env.REGISTRATION_ENABLED) return reply.code(403).send({ error: 'registration_disabled' });
        try {
          user = await ctx.prisma.user.create({
            data: {
              name: id.name ?? id.email.split('@')[0]!.slice(0, 100),
              email: id.email,
              googleUid: id.uid,
              avatarUrl: id.picture,
            },
          });
        } catch (err) {
          // Two first sign-ins at once: the other one created it.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return reply.code(409).send({ error: 'conflict', message: 'Try signing in again' });
          }
          throw err;
        }
        action = 'user.registered';
      }
    } else if (id.picture && user.avatarUrl !== id.picture) {
      user = await ctx.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: id.picture } });
    }

    await startSession(ctx, req, reply, user.id);
    await audit(ctx.prisma, {
      userId: user.id,
      actorType: 'user',
      actorId: user.id,
      action,
      targetType: 'user',
      targetId: user.id,
      ip: req.ip,
      metadata: { method: 'google' },
    });
    return reply.code(action === 'user.registered' ? 201 : 200).send({ user: toUserDto(user) });
  });

  app.post('/auth/logout', { preHandler: [trusted, requireUser(ctx)] }, async (req, reply) => {
    const user = req.user!;
    await ctx.prisma.authSession.update({ where: { id: user.sessionId }, data: { revokedAt: ctx.now() } });
    await audit(ctx.prisma, {
      userId: user.id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.logout',
      targetType: 'user',
      targetId: user.id,
      ip: req.ip,
    });
    clearSessionCookie(ctx, reply);
    // Close live dashboard sockets that were opened with this login session.
    await ctx.bus.publish(CHANNELS.authSessionEnded, user.sessionId).catch(() => undefined);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: requireUser(ctx) }, async (req) => ({ user: toUserDto(req.user!) }));
}
