import { BackendToWeb } from '@pocket-agent/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { loadUser, requireTrustedOrigin, requireUser } from '../auth/session.js';
import { limit, redisKey, type AppContext } from '../context.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { CHANNELS, type Bus } from './bus.js';

const PING_INTERVAL_MS = 25_000;
/** A WebSocket ticket is single-use and short-lived. */
export const WS_TICKET_TTL_S = 60;

interface ClientSocket {
  socket: WebSocket;
  authSessionId: string;
}

/**
 * `/ws/client`: live updates for the dashboard. Server → browser only; the browser never sends
 * commands over it. Authenticated with the session cookie, and the Origin must be on the
 * allow-list (browsers always send Origin on WebSocket handshakes — this blocks cross-site
 * WebSocket hijacking with the user's cookie).
 *
 * When the dashboard is served from another site than the API (e.g. *.vercel.app → *.onrender.com),
 * the browser won't send the API's cookie on the WebSocket. The page then gets a one-time ticket
 * from `POST /ws/tickets` (same-origin through the web app's /api proxy, cookie-authenticated) and
 * connects with `?ticket=`. The ticket is bound to that login session and dies after one use or
 * 60 s.
 */
export async function clientGateway(app: FastifyInstance, ctx: AppContext & { bus: Bus }): Promise<void> {
  const byUser = new Map<string, Set<ClientSocket>>();
  const authed = new WeakMap<FastifyRequest, { userId: string; authSessionId: string }>();

  ctx.bus.on(CHANNELS.userEvents, (raw) => {
    const { userId, event } = JSON.parse(raw) as { userId: string; event: unknown };
    const clients = byUser.get(userId);
    if (!clients?.size) return;
    const parsed = BackendToWeb.safeParse(event);
    if (!parsed.success) return app.log.error('dropping off-contract browser event');
    const frame = JSON.stringify(parsed.data);
    for (const c of clients) c.socket.send(frame);
  });

  ctx.bus.on(CHANNELS.authSessionEnded, (authSessionId) => {
    for (const clients of byUser.values()) {
      for (const c of clients) if (c.authSessionId === authSessionId) c.socket.close(4401, 'signed out');
    }
  });

  app.addHook('onClose', async () => {
    for (const clients of byUser.values())
      for (const c of clients) c.socket.close(1001, 'server shutting down');
  });

  app.post(
    '/ws/tickets',
    { preHandler: [requireTrustedOrigin(ctx), requireUser(ctx)], config: limit(ctx, 60) },
    async (req) => {
      const ticket = randomToken();
      await ctx.redis.set(
        redisKey(ctx, 'ws-ticket', sha256(ticket)),
        JSON.stringify({ userId: req.user!.id, authSessionId: req.user!.sessionId }),
        'EX',
        WS_TICKET_TTL_S,
      );
      return { ticket, expiresInSeconds: WS_TICKET_TTL_S };
    },
  );

  /** Consumes a ticket; null unless it exists and its login session is still valid. */
  const redeem = async (ticket: string) => {
    if (ticket.length > 100) return null;
    const raw = await ctx.redis.getdel(redisKey(ctx, 'ws-ticket', sha256(ticket)));
    if (!raw) return null;
    const t = JSON.parse(raw) as { userId: string; authSessionId: string };
    const s = await ctx.prisma.authSession.findUnique({ where: { id: t.authSessionId } });
    if (!s || s.userId !== t.userId || s.revokedAt || s.expiresAt <= ctx.now()) return null;
    return t;
  };

  app.get(
    '/ws/client',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        if (!origin || !ctx.env.WEB_ORIGINS.includes(origin)) {
          return reply.code(403).send({ error: 'untrusted_origin' });
        }
        const ticket = (req.query as { ticket?: unknown } | undefined)?.ticket;
        if (typeof ticket === 'string') {
          const t = await redeem(ticket);
          if (!t) return reply.code(401).send({ error: 'unauthenticated' });
          authed.set(req, t);
          return;
        }
        await loadUser(ctx, req);
        if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
        authed.set(req, { userId: req.user.id, authSessionId: req.user.sessionId });
      },
    },
    (socket, req) => {
      const { userId, authSessionId } = authed.get(req)!;
      const entry: ClientSocket = { socket, authSessionId };
      if (!byUser.has(userId)) byUser.set(userId, new Set());
      byUser.get(userId)!.add(entry);

      let alive = true;
      socket.on('pong', () => (alive = true));
      const pinger = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, PING_INTERVAL_MS);

      // Browsers don't send anything meaningful; ignore input rather than parse it.
      socket.on('message', () => undefined);
      socket.on('close', () => {
        clearInterval(pinger);
        const set = byUser.get(userId);
        set?.delete(entry);
        if (set && set.size === 0) byUser.delete(userId);
      });
    },
  );
}
