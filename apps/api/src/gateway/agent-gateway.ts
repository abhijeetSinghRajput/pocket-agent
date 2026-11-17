import {
  AgentToBackend,
  BackendToAgent,
  createEvent,
  MAX_FRAME_BYTES,
  OFFLINE_AFTER_MS,
  WS_CLOSE,
} from '@agentdock/protocol';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { authenticateDevice } from '../auth/device-auth.js';
import { redisKey, type AppContext } from '../context.js';
import type { Device } from '../generated/prisma/client.js';

const REVOKE_CHANNEL = 'device-revoked';
/** Invalid frames tolerated per connection before it is closed. */
const MAX_INVALID_FRAMES = 10;
const PING_INTERVAL_MS = 15_000;
const SWEEP_INTERVAL_MS = 15_000;

/** Tells every API instance to drop the device's live connection. */
export async function publishRevocation(ctx: AppContext, deviceId: string): Promise<void> {
  await ctx.redis.publish(redisKey(ctx, REVOKE_CHANNEL), deviceId);
}

export interface GatewayOptions {
  pingIntervalMs?: number;
  sweepIntervalMs?: number;
}

/**
 * `/ws/agent`: the only way a Local Agent talks to the backend in real time.
 * The PC always dials out; credentials are checked before the WebSocket upgrade.
 */
export async function agentGateway(app: FastifyInstance, ctx: AppContext & GatewayOptions): Promise<void> {
  const instanceId = randomUUID();
  const sockets = new Map<string, WebSocket>();
  const authed = new WeakMap<FastifyRequest, Device>();
  const presenceKey = (deviceId: string) => redisKey(ctx, 'presence', deviceId);

  const send = (socket: WebSocket, msg: unknown) => {
    // Outgoing messages are validated too, so a server bug can't emit an off-contract frame.
    socket.send(JSON.stringify(BackendToAgent.parse(msg)));
  };

  const closeRevoked = (socket: WebSocket) => {
    try {
      send(socket, createEvent('device.revoke', { reason: 'Device was revoked by its owner' }));
    } finally {
      socket.close(WS_CLOSE.REVOKED, 'device revoked');
    }
  };

  // Cross-instance revocation. ioredis re-subscribes automatically after reconnects.
  const subscriber = ctx.redis.duplicate({ enableOfflineQueue: true, lazyConnect: false });
  subscriber.on('error', (err) => app.log.warn({ err: err.message }, 'revocation subscriber error'));
  void subscriber.subscribe(redisKey(ctx, REVOKE_CHANNEL)).catch(() => undefined);
  subscriber.on('message', (_channel, deviceId) => {
    const socket = sockets.get(deviceId);
    if (socket) closeRevoked(socket);
  });

  // Marks devices Offline when their heartbeats stop (covers crashed API instances too).
  const sweeper = setInterval(() => {
    void ctx.prisma.device
      .updateMany({
        where: {
          status: 'Online',
          lastHeartbeatAt: { lt: new Date(ctx.now().getTime() - OFFLINE_AFTER_MS) },
        },
        data: { status: 'Offline' },
      })
      .catch((err: unknown) => app.log.warn({ err }, 'offline sweep failed'));
  }, ctx.sweepIntervalMs ?? SWEEP_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    for (const s of sockets.values()) s.close(WS_CLOSE.GOING_AWAY, 'server shutting down');
    await subscriber.quit().catch(() => undefined);
  });

  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  app.get(
    '/ws/agent',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const auth = await authenticateDevice(ctx, req.headers.authorization);
        if (!auth.ok) {
          return reply
            .code(401)
            .send({ error: auth.reason === 'revoked' ? 'device_revoked' : 'unauthorized' });
        }
        authed.set(req, auth.device);
      },
    },
    (socket, req) => {
      const device = authed.get(req)!;
      const log = app.log.child({ deviceId: device.id });

      const previous = sockets.get(device.id);
      if (previous) previous.close(WS_CLOSE.REPLACED, 'replaced by a newer connection');
      sockets.set(device.id, socket);

      const touch = async (data: { agentVersion?: string; platform?: Device['platform'] } = {}) => {
        const r = await ctx.prisma.device.updateMany({
          where: { id: device.id, revokedAt: null },
          data: { ...data, status: 'Online', lastHeartbeatAt: ctx.now() },
        });
        if (r.count === 0) return false; // revoked in the meantime
        await ctx.redis
          .set(presenceKey(device.id), instanceId, 'PX', OFFLINE_AFTER_MS)
          .catch(() => undefined);
        return true;
      };

      let alive = true;
      socket.on('pong', () => (alive = true));
      const pinger = setInterval(() => {
        if (!alive) return socket.terminate(); // half-open connection
        alive = false;
        socket.ping();
      }, ctx.pingIntervalMs ?? PING_INTERVAL_MS);

      let invalid = 0;
      const reject = (why: string) => {
        invalid++;
        log.warn({ why, invalid }, 'invalid frame from agent');
        if (invalid > MAX_INVALID_FRAMES) socket.close(WS_CLOSE.POLICY_VIOLATION, 'too many invalid frames');
      };

      const handle = async (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return reject('binary frame');
        let json: unknown;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          return reject('not json');
        }
        const parsed = AgentToBackend.safeParse(json);
        if (!parsed.success) return reject('schema');
        const msg = parsed.data;
        if (msg.deviceId && msg.deviceId !== device.id) return reject('deviceId mismatch');

        switch (msg.eventType) {
          case 'device.connected':
          case 'device.heartbeat': {
            const fields =
              msg.eventType === 'device.connected'
                ? { agentVersion: msg.payload.agentVersion, platform: msg.payload.platform }
                : {};
            if (!(await touch(fields))) return closeRevoked(socket);
            send(socket, createEvent('ack', { ackEventId: msg.eventId }));
            return;
          }
          default:
            // Session/tool/permission events are processed from M3 on.
            log.debug({ eventType: msg.eventType }, 'event not handled yet');
        }
      };

      // Process frames strictly in order.
      let chain = Promise.resolve();
      socket.on('message', (data, isBinary) => {
        chain = chain
          .then(() => handle(data as Buffer, isBinary))
          .catch((err: unknown) => log.error({ err }, 'frame handling failed'));
      });

      socket.on('close', (code) => {
        clearInterval(pinger);
        if (sockets.get(device.id) !== socket) return; // replaced: the new socket owns presence
        sockets.delete(device.id);
        log.info({ code }, 'agent disconnected');
        void ctx.prisma.device
          .updateMany({ where: { id: device.id, revokedAt: null }, data: { status: 'Offline' } })
          .catch(() => undefined);
        void ctx.redis.del(presenceKey(device.id)).catch(() => undefined);
      });

      log.info('agent connected');
      void touch().then((ok) => {
        if (!ok) closeRevoked(socket);
      });
    },
  );
}
