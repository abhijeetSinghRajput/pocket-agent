import {
  AgentToBackend,
  BackendToAgent,
  createEvent,
  OFFLINE_AFTER_MS,
  WS_CLOSE,
} from '@pocket-agent/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { authenticateDevice } from '../auth/device-auth.js';
import { redisKey, type AppContext } from '../context.js';
import { Prisma, type Device } from '../generated/prisma/client.js';
import { applyDecisionAck } from '../approvals/service.js';
import { applyCommandAck, resendPending } from '../commands/service.js';
import { pcAnswered } from '../devices/ask-pc.js';
import type { PushSender } from '../notifications/push.js';
import { notifyFromEvents } from '../notifications/triggers.js';
import { CHANNELS, notifyUser, type Bus } from '../realtime/bus.js';
import {
  ingestSessionEvent,
  InvalidAgentEvent,
  isSessionEvent,
  markDeviceSessionsDisconnected,
} from '../sessions/ingest.js';

/** Invalid frames tolerated per connection before it is closed. */
const MAX_INVALID_FRAMES = 10;
const PING_INTERVAL_MS = 15_000;
const SWEEP_INTERVAL_MS = 15_000;
/** On shutdown, how long a PC gets to answer the close frame before its socket is cut. */
const CLOSE_WAIT_MS = 2_000;

/** Tells every API instance to drop the device's live connection. */
export async function publishRevocation(ctx: AppContext, deviceId: string): Promise<void> {
  await ctx.redis.publish(redisKey(ctx, CHANNELS.deviceRevoked), deviceId);
}

export interface GatewayOptions {
  pingIntervalMs?: number;
  sweepIntervalMs?: number;
}

export type GatewayServices = AppContext & GatewayOptions & { bus: Bus; push: PushSender };

/**
 * `/ws/agent`: the only way a Local Agent talks to the backend in real time.
 * The PC always dials out; credentials are checked before the WebSocket upgrade.
 */
export async function agentGateway(app: FastifyInstance, ctx: GatewayServices): Promise<void> {
  const instanceId = randomUUID();
  const sockets = new Map<string, WebSocket>();
  const authed = new WeakMap<FastifyRequest, Device>();
  const presenceKey = (deviceId: string) => redisKey(ctx, 'presence', deviceId);
  // Writes started by closing sockets; shutdown waits for them before the DB and Redis go away.
  const pending = new Set<Promise<void>>();
  const track = (work: Promise<unknown>) => {
    const p: Promise<void> = work
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => pending.delete(p));
    pending.add(p);
  };

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

  const deviceChanged = async (deviceId: string) => {
    const d = await ctx.prisma.device.findUnique({ where: { id: deviceId } });
    if (!d) return;
    await notifyUser(
      ctx.bus,
      d.userId,
      createEvent(
        'device.status.changed',
        {
          status: d.revokedAt ? 'Revoked' : d.status,
          lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
        },
        { deviceId },
      ),
    );
  };

  const goOffline = async (deviceId: string) => {
    await markDeviceSessionsDisconnected(ctx, deviceId);
    await deviceChanged(deviceId);
  };

  // Commands are created on any instance; the one holding the device's socket delivers them.
  ctx.bus.on(CHANNELS.agentCommands, (raw) => {
    const { deviceId, frame } = JSON.parse(raw) as { deviceId: string; frame: unknown };
    const socket = sockets.get(deviceId);
    if (socket) send(socket, frame);
  });

  ctx.bus.on(CHANNELS.deviceRevoked, (deviceId) => {
    const socket = sockets.get(deviceId);
    if (socket) closeRevoked(socket);
  });

  // Marks devices Offline when their heartbeats stop (covers crashed API instances too).
  const sweeper = setInterval(() => {
    void (async () => {
      const stale = await ctx.prisma.device.findMany({
        where: {
          status: 'Online',
          lastHeartbeatAt: { lt: new Date(ctx.now().getTime() - OFFLINE_AFTER_MS) },
        },
        select: { id: true },
      });
      for (const { id } of stale) {
        const r = await ctx.prisma.device.updateMany({
          where: { id, status: 'Online' },
          data: { status: 'Offline' },
        });
        if (r.count) await goOffline(id);
      }
    })().catch((err: unknown) => app.log.warn({ err }, 'offline sweep failed'));
  }, ctx.sweepIntervalMs ?? SWEEP_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    await Promise.all(
      [...sockets.values()].map(
        (s) =>
          new Promise<void>((resolve) => {
            s.once('close', () => resolve());
            s.close(WS_CLOSE.GOING_AWAY, 'server shutting down');
            setTimeout(() => s.terminate(), CLOSE_WAIT_MS).unref();
          }),
      ),
    );
    await Promise.allSettled([...pending]);
  });

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
      const ack = (eventId: string) => send(socket, createEvent('ack', { ackEventId: eventId }));

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

        if (msg.eventType === 'device.connected' || msg.eventType === 'device.heartbeat') {
          const fields =
            msg.eventType === 'device.connected'
              ? { agentVersion: msg.payload.agentVersion, platform: msg.payload.platform }
              : {};
          if (!(await touch(fields))) return closeRevoked(socket);
          if (msg.eventType === 'device.connected') void deviceChanged(device.id);
          return ack(msg.eventId);
        }

        if (isSessionEvent(msg)) {
          try {
            const notifications = await ingestSessionEvent(ctx, device, msg);
            ack(msg.eventId); // only after the event is durably stored
            for (const n of notifications) await notifyUser(ctx.bus, device.userId, n);
            // Notifications/push never hold up the agent link.
            void notifyFromEvents(ctx, notifications).catch((err: unknown) =>
              app.log.warn({ err }, 'notification trigger failed'),
            );
          } catch (err) {
            if (err instanceof InvalidAgentEvent) return reject(err.message);
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              return ack(msg.eventId); // concurrent replay already stored it
            }
            throw err; // not acked → the agent resends after reconnecting
          }
          return;
        }

        if (msg.eventType === 'command.ack') {
          await applyCommandAck(ctx, device, msg.payload);
          return ack(msg.eventId);
        }

        if (msg.eventType === 'device.settings') {
          await ctx.prisma.device.updateMany({
            where: { id: device.id, revokedAt: null },
            data: {
              projects: msg.payload.projects,
              models: msg.payload.models,
              // Only sent by PCs that can read it; an older agent leaves the stored value alone.
              ...(msg.payload.usage !== undefined ? { usage: msg.payload.usage ?? Prisma.DbNull } : {}),
              ...(msg.payload.health ? { health: msg.payload.health } : {}),
              observedInstructions: msg.payload.observedInstructions,
              remoteApprovalEnabled: msg.payload.remoteApproval,
            },
          });
          void deviceChanged(device.id);
          return ack(msg.eventId);
        }

        if (msg.eventType === 'folder.listed' || msg.eventType === 'agents.read.result') {
          // An answer to something the app asked; the request may be waiting on another instance.
          const { requestId, ...answer } = msg.payload;
          await pcAnswered(ctx, requestId, answer);
          return;
        }

        if (msg.eventType === 'approval.decision.ack') {
          await applyDecisionAck(ctx, device, msg.payload);
          return ack(msg.eventId);
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
        track(chain); // frames still being handled
        if (sockets.get(device.id) !== socket) return; // replaced: the new socket owns presence
        sockets.delete(device.id);
        log.info({ code }, 'agent disconnected');
        track(
          (async () => {
            await ctx.prisma.device.updateMany({
              where: { id: device.id, revokedAt: null },
              data: { status: 'Offline' },
            });
            await ctx.redis.del(presenceKey(device.id)).catch(() => undefined);
            await goOffline(device.id);
          })(),
        );
      });

      log.info('agent connected');
      void touch().then(async (ok) => {
        if (!ok) return closeRevoked(socket);
        await deviceChanged(device.id);
        // Tell the PC whether its user is away (decides where permission requests go).
        const d = await ctx.prisma.device.findUnique({
          where: { id: device.id },
          select: { awayMode: true },
        });
        send(
          socket,
          createEvent('config.update', { awayMode: d?.awayMode ?? false }, { deviceId: device.id }),
        );
        await resendPending(ctx, device.id).catch((err: unknown) => log.warn({ err }, 'resend failed'));
      });
    },
  );
}
