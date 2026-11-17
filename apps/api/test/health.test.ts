import { HealthResponse } from '@agentdock/protocol';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Probe } from '../src/routes/health.js';

const up: Probe = async () => 1;
const down: Probe = async () => {
  throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
};
const hang: Probe = () => new Promise(() => undefined);

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function make(database: Probe, redis: Probe) {
  app = await buildApp({
    env: { WEB_ORIGINS: ['http://localhost:3000'], NODE_ENV: 'test' },
    health: { version: '0.0.0-test', probes: { database, redis }, timeoutMs: 100 },
  });
  return app;
}

describe('GET /health', () => {
  it('returns 200 and a schema-valid body when all dependencies are up', async () => {
    const res = await (await make(up, up)).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('up');
  });

  it('returns 503 degraded when redis is down', async () => {
    const res = await (await make(up, down)).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    const body = HealthResponse.parse(res.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toMatchObject({ status: 'down' });
  });

  it('does not hang when a dependency hangs', async () => {
    const res = await (await make(hang, up)).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database.error).toMatch(/timeout/);
  });

  it('liveness never touches dependencies', async () => {
    const res = await (await make(hang, hang)).inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });
});

describe('safety switches', () => {
  it('refuses to disable rate limits outside tests', async () => {
    await expect(
      buildApp({
        env: { WEB_ORIGINS: ['https://app.example.com'], NODE_ENV: 'production' },
        health: { version: 'x', probes: { database: up, redis: up } },
        disableRateLimits: true,
      }),
    ).rejects.toThrow(/only allowed when NODE_ENV=test/);
  });
});

describe('HTTP hardening', () => {
  it('allows CORS only for configured origins', async () => {
    const a = await make(up, up);
    const ok = await a.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await a.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers', async () => {
    const res = await (await make(up, up)).inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a generic 404', async () => {
    const res = await (await make(up, up)).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
