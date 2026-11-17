import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';
import { healthRoutes, type HealthDeps } from './routes/health.js';

export interface AppDeps {
  env: Pick<Env, 'WEB_ORIGINS' | 'NODE_ENV'>;
  health: HealthDeps;
  logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify app without listening, so tests can use app.inject(). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.env.NODE_ENV === 'production',
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: deps.env.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await app.register(healthRoutes, deps.health);

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err: unknown, req, reply) => {
    const e = (typeof err === 'object' && err !== null ? err : {}) as { statusCode?: number; code?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    // Never leak internals (stack traces, SQL) to clients.
    return reply.code(status).send({ error: status >= 500 ? 'internal_error' : (e.code ?? 'bad_request') });
  });

  return app;
}
