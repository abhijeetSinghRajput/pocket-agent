import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export const SESSION_COOKIE = 'pocket_agent_session';

/** Creates a login session and sets the httpOnly cookie. Only the token's hash is stored. */
export async function startSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const token = randomToken();
  const ttlMs = ctx.env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  await ctx.prisma.authSession.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      ip: req.ip,
      expiresAt: new Date(ctx.now().getTime() + ttlMs),
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: ctx.env.COOKIE_DOMAIN,
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', domain: ctx.env.COOKIE_DOMAIN });
}

/** Resolves the session cookie to a user. Expired or revoked sessions resolve to null. */
export async function loadUser(ctx: AppContext, req: FastifyRequest): Promise<void> {
  req.user = null;
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return;
  const session = await ctx.prisma.authSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= ctx.now()) return;
  const { id, name, email, createdAt, avatarUrl } = session.user;
  req.user = { id, name, email, createdAt, avatarUrl, sessionId: session.id };
}

/** preHandler: 401 unless a valid browser session is present. */
export function requireUser(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await loadUser(ctx, req);
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
  };
}

/**
 * preHandler for browser-facing state-changing routes (CSRF defence in depth on top of
 * SameSite=Lax): the Origin header must be present and on the WEB_ORIGINS allow-list.
 */
export function requireTrustedOrigin(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (!origin || !ctx.env.WEB_ORIGINS.includes(origin)) {
      return reply.code(403).send({ error: 'untrusted_origin' });
    }
  };
}

export function toUserDto(u: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  avatarUrl?: string | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}
