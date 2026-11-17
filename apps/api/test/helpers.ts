// Shared helpers for integration tests (real Postgres + Redis, real HTTP/WebSocket).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createPrisma, createRedis } from '../src/infra.js';
import { hashPassword, randomToken, sha256 } from '../src/lib/crypto.js';
import type { AppContext } from '../src/context.js';

export const ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  baseUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

/** Real app on a random port with an isolated Redis key prefix. */
export async function startTestApp(
  opts: { sweepIntervalMs?: number; pingIntervalMs?: number; rateLimits?: boolean } = {},
): Promise<TestApp> {
  const env = loadEnv({
    ...process.env,
    WEB_ORIGINS: ORIGIN,
    REDIS_KEY_PREFIX: `agentdock-test:${randomUUID()}:`,
    COOKIE_SECURE: 'false',
  });
  const prisma = createPrisma(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  await redis.connect();
  const ctx: AppContext & typeof opts = { env, prisma, redis, now: () => new Date(), ...opts };
  const app = await buildApp({
    env,
    ctx,
    disableRateLimits: !opts.rateLimits,
    health: {
      version: 'test',
      probes: { database: () => prisma.$queryRaw`SELECT 1`, redis: () => redis.ping() },
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as { port: number };
  return {
    app,
    ctx,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws/agent`,
    close: async () => {
      await app.close();
      const keys = await redis.keys(`${env.REDIS_KEY_PREFIX}*`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
      await prisma.$disconnect();
    },
  };
}

export function uniqueEmail(): string {
  return `t-${randomUUID()}@test.invalid`;
}

/** Creates a user and a session directly (bypassing /auth/login and its rate limit). */
export async function createUserWithSession(ctx: AppContext, password = 'correct horse battery') {
  const user = await ctx.prisma.user.create({
    data: { name: 'Test User', email: uniqueEmail(), passwordHash: await hashPassword(password) },
  });
  const token = randomToken();
  await ctx.prisma.authSession.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { user, password, cookie: `agentdock_session=${token}` };
}

/** Headers a browser on the web origin would send. */
export function browser(cookie?: string): Record<string, string> {
  return { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
}

/** Pairs a device for the user through the real pairing flow. */
export async function pairDevice(t: TestApp, cookie: string) {
  const codeRes = await t.app.inject({
    method: 'POST',
    url: '/devices/pairing-codes',
    headers: browser(cookie),
  });
  const { code } = codeRes.json() as { code: string };
  const res = await t.app.inject({
    method: 'POST',
    url: '/devices/pair',
    payload: { code, name: 'Test PC', platform: 'windows', agentVersion: '0.1.0' },
  });
  return res.json() as { deviceId: string; deviceSecret: string };
}

export async function deleteUser(ctx: AppContext, userId: string): Promise<void> {
  await ctx.prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}
