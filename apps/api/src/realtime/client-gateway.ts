import { BackendToWeb } from '@agentdock/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { loadUser } from '../auth/session.js';
import type { AppContext } from '../context.js';
import { CHANNELS, type Bus } from './bus.js';

const PING_INTERVAL_MS = 25_000;

interface ClientSocket {
  socket: WebSocket;
  authSessionId: string;
}

/**
 * `/ws/client`: live updates for the dashboard. Server → browser only; the browser never sends
 * commands over it. Authenticated with the session cookie, and the Origin must be on the
 * allow-list (browsers always send Origin on WebSocket handshakes — this blocks cross-site
 * WebSocket hijacking with the user's cookie).
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

  app.get(
    '/ws/client',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        if (!origin || !ctx.env.WEB_ORIGINS.includes(origin)) {
          return reply.code(403).send({ error: 'untrusted_origin' });
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
