import type { BackendToWeb } from '@agentdock/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { redisKey, type AppContext } from '../context.js';

/** Channels shared by every API instance (Redis pub/sub). */
export const CHANNELS = {
  /** payload: deviceId — drop that device's agent connection. */
  deviceRevoked: 'device-revoked',
  /** payload: JSON { userId, event } — push a BackendToWeb event to that user's browsers. */
  userEvents: 'user-events',
  /** payload: auth session id — close browser sockets opened with that login session. */
  authSessionEnded: 'auth-session-ended',
} as const;
type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface Bus {
  publish(channel: Channel, payload: string): Promise<void>;
  on(channel: Channel, handler: (payload: string) => void): void;
  close(): Promise<void>;
}

export function createBus(ctx: AppContext, log: FastifyBaseLogger): Bus {
  // A dedicated connection is required for SUBSCRIBE. ioredis re-subscribes after reconnects.
  const sub = ctx.redis.duplicate({ enableOfflineQueue: true, lazyConnect: false });
  sub.on('error', (err) => log.warn({ err: err.message }, 'bus subscriber error'));
  const handlers = new Map<string, Array<(payload: string) => void>>();

  sub.on('message', (channel: string, payload: string) => {
    for (const h of handlers.get(channel) ?? []) {
      try {
        h(payload);
      } catch (err) {
        log.error({ err, channel }, 'bus handler failed');
      }
    }
  });

  return {
    async publish(channel, payload) {
      await ctx.redis.publish(redisKey(ctx, channel), payload);
    },
    on(channel, handler) {
      const key = redisKey(ctx, channel);
      if (!handlers.has(key)) {
        handlers.set(key, []);
        void sub.subscribe(key).catch(() => undefined);
      }
      handlers.get(key)!.push(handler);
    },
    async close() {
      await sub.quit().catch(() => undefined);
    },
  };
}

/** Pushes an event to all of a user's open browser tabs, on any API instance. Best effort. */
export async function notifyUser(bus: Bus, userId: string, event: BackendToWeb): Promise<void> {
  await bus.publish(CHANNELS.userEvents, JSON.stringify({ userId, event })).catch(() => undefined);
}
