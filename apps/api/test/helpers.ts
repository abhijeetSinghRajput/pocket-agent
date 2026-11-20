// Shared helpers for integration tests (real Postgres + Redis, real HTTP/WebSocket).
import { createEvent, deviceAuthHeader } from '@agentdock/protocol';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createPrisma, createRedis } from '../src/infra.js';
import { hashPassword, randomToken, sha256 } from '../src/lib/crypto.js';
import type { AppContext } from '../src/context.js';
import type { PushMessage, PushResult, PushSender } from '../src/notifications/push.js';

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
  opts: {
    sweepIntervalMs?: number;
    pingIntervalMs?: number;
    rateLimits?: boolean;
    offlineCheckMs?: number;
    push?: PushSender;
    now?: () => Date;
  } = {},
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
  const { push, ...rest } = opts;
  const ctx: AppContext & typeof rest = { env, prisma, redis, now: () => new Date(), ...rest };
  const app = await buildApp({
    env,
    ctx,
    ...(push ? { push } : {}),
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

// ── WebSocket helpers ───────────────────────────────────────────────────────

/** Connects and buffers incoming JSON messages so none are missed. */
export function wsClient(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers });
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<{ code: number }>((resolve) => ws.on('close', (code) => resolve({ code })));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
  const next = async (pred: (m: Record<string, unknown>) => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error('timed out waiting for message');
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, opened, closed, next, inbox };
}

/** A connected Local Agent that sends protocol events and waits for their acks. */
export async function connectAgent(t: TestApp, d: { deviceId: string; deviceSecret: string }) {
  const c = wsClient(t.wsUrl, { authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) });
  await c.opened;
  const sendRaw = (msg: { eventId: string }) => c.ws.send(JSON.stringify(msg));
  const send = async (msg: { eventId: string }) => {
    sendRaw(msg);
    await c.next((m) => (m['payload'] as { ackEventId?: string } | undefined)?.ackEventId === msg.eventId);
  };
  return { ...c, send, sendRaw };
}

export function sessionStarted(externalSessionId: string, over: Record<string, unknown> = {}) {
  return createEvent(
    'agent.session.started',
    {
      provider: 'claude-code' as const,
      mode: 'observed' as const,
      externalSessionId,
      projectPath: String.raw`C:\work\demo`,
      projectName: 'demo',
      status: 'WaitingForInput' as const,
      capabilities: {
        monitor: true,
        remoteApproval: true,
        instructAnytime: false,
        instructBetweenTurns: true,
        interrupt: false,
      },
      metadata: { entrypoint: 'claude-vscode' },
      ...over,
    },
    { sessionId: externalSessionId },
  );
}

export const waitFor = async (check: () => Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Records pushes instead of calling FCM. Tokens starting with "dead-" are reported unregistered. */
export function fakePush() {
  const sent: Array<{ token: string; message: PushMessage }> = [];
  const sender: PushSender = {
    available: true,
    send: async (token, message): Promise<PushResult> => {
      if (token.startsWith('dead-')) return 'invalid_token';
      sent.push({ token, message });
      return 'ok';
    },
  };
  return { sender, sent };
}
