// Integration: real Postgres + Redis (pnpm infra:up && pnpm db:migrate).
import { HealthResponse } from '@pocket-agent/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { createPrisma, createRedis } from '../src/infra.js';

if (!process.env['DATABASE_URL']) process.loadEnvFile('.env');
const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

beforeAll(async () => {
  await redis.connect();
});
afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('infrastructure', () => {
  it('reports healthy against real dependencies', async () => {
    const app = await buildApp({
      env,
      health: {
        version: 'int',
        probes: { database: () => prisma.$queryRaw`SELECT 1`, redis: () => redis.ping() },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json()).status).toBe('ok');
  });

  it('has all migrations applied (every model is queryable)', async () => {
    await expect(
      Promise.all([
        prisma.user.count(),
        prisma.device.count(),
        prisma.agentSession.count(),
        prisma.agentEvent.count(),
        prisma.command.count(),
        prisma.approval.count(),
        prisma.notification.count(),
        prisma.pushSubscription.count(),
        prisma.auditLog.count(),
      ]),
    ).resolves.toHaveLength(9);
  });

  it('enforces one session per (device, externalSessionId)', async () => {
    const tag = crypto.randomUUID();
    const user = await prisma.user.create({
      data: { name: 'Int Test', email: `int-${tag}@test.invalid`, passwordHash: 'x' },
    });
    try {
      const device = await prisma.device.create({
        data: { userId: user.id, name: 'pc', platform: 'windows', agentVersion: '0', secretHash: `h-${tag}` },
      });
      expect(device.remoteApprovalEnabled).toBe(false); // opt-in by default
      const data = {
        deviceId: device.id,
        provider: 'claude-code',
        mode: 'observed' as const,
        externalSessionId: 'sess-1',
        projectName: 'p',
        projectPath: 'C:/p',
        capabilities: {},
      };
      await prisma.agentSession.create({ data });
      await expect(prisma.agentSession.create({ data })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: user.id } }); // cascades
    }
  });
});
