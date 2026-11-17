import type { DependencyHealth, HealthResponse } from '@agentdock/protocol';
import type { FastifyInstance } from 'fastify';

/** A dependency probe resolves when the dependency is reachable and rejects otherwise. */
export type Probe = () => Promise<unknown>;

export interface HealthDeps {
  version: string;
  probes: { database: Probe; redis: Probe };
  /** Per-probe timeout so a hung dependency cannot hang the health check. */
  timeoutMs?: number;
}

async function check(probe: Probe, timeoutMs: number): Promise<DependencyHealth> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    // Report the error class/message only; connection strings never appear in probe errors we surface.
    const message = err instanceof Error ? err.message : 'unreachable';
    return { status: 'down', error: message.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export async function healthRoutes(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 2_000;

  /** Liveness: the process is up. Never touches dependencies. */
  app.get('/health/live', async () => ({ status: 'ok' }));

  /** Readiness: dependencies reachable. 503 when degraded so load balancers stop routing. */
  app.get('/health', async (_req, reply) => {
    const [database, redis] = await Promise.all([
      check(deps.probes.database, timeoutMs),
      check(deps.probes.redis, timeoutMs),
    ]);
    const ok = database.status === 'up' && redis.status === 'up';
    const body: HealthResponse = {
      status: ok ? 'ok' : 'degraded',
      service: 'agentdock-api',
      version: deps.version,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis },
    };
    return reply.code(ok ? 200 : 503).send(body);
  });
}
