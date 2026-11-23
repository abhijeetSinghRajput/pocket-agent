import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export const SESSION_COOKIE = 'pocket_agent_session';

/**
 * Sent by the native apps (Android / iOS). They are not browsers: there is no cookie jar shared
 * with web pages, so they keep the session token themselves (in the device's secure storage) and
 * send it as `Authorization: Bearer <token>`.
 */
export const CLIENT_HEADER = 'x-pocket-agent-client';
export const isNativeApp = (req: FastifyRequest) => req.headers[CLIENT_HEADER] === 'mobile';

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  const m = typeof header === 'string' ? /^Bearer (\S{20,100})$/.exec(header) : null;
  return m ? m[1]! : null;
}

/**
 * Creates a login session. Browsers get the httpOnly cookie; a native app gets the token back
 * (returned here, for the response body) and no cookie. Only the token's hash is stored.
 */
export async function startSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<string | undefined> {
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
  if (isNativeApp(req)) return token;
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: ctx.env.COOKIE_DOMAIN,
    maxAge: Math.floor(ttlMs / 1000),
  });
  return undefined;
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', domain: ctx.env.COOKIE_DOMAIN });
}

/**
 * Resolves the session (a native app's bearer token, else the browser's cookie) to a user.
 * Expired or revoked sessions resolve to null.
 */
export async function loadUser(ctx: AppContext, req: FastifyRequest): Promise<void> {
  req.user = null;
  const token = bearerToken(req) ?? req.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return;
  const session = await ctx.prisma.authSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= ctx.now()) return;
  const { id, name, email, createdAt, avatarUrl } = session.user;
  req.user = { id, name, email, createdAt, avatarUrl, sessionId: session.id };
}

/** preHandler: 401 unless a valid session (browser cookie or app token) is present. */
export function requireUser(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await loadUser(ctx, req);
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
  };
}

/**
 * preHandler for state-changing routes (CSRF defence in depth on top of SameSite=Lax): a browser
 * request must carry an Origin on the WEB_ORIGINS allow-list.
 *
 * The native apps send no Origin; they identify themselves with the client header instead. A web
 * page can't forge that: browsers put an Origin on every cross-site POST, and a custom header
 * needs a CORS preflight, which is only answered for the allow-listed origins.
 */
export function requireTrustedOrigin(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    const trusted = origin ? ctx.env.WEB_ORIGINS.includes(origin) : isNativeApp(req);
    if (!trusted) return reply.code(403).send({ error: 'untrusted_origin' });
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
