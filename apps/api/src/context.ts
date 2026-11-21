import type { Env } from './env.js';
import type { PrismaClient, Redis } from './infra.js';

/** Long-lived dependencies shared by routes and the gateway. */
export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  /** Injectable clock for tests. */
  now: () => Date;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  avatarUrl: string | null;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

/** Route rate-limit config scaled by RATE_LIMIT_SCALE. */
export function limit(ctx: Pick<AppContext, 'env'>, max: number, timeWindow = '1 minute') {
  return { rateLimit: { max: Math.max(1, Math.ceil(max * ctx.env.RATE_LIMIT_SCALE)), timeWindow } };
}

export function redisKey(ctx: Pick<AppContext, 'env'>, ...parts: string[]): string {
  return ctx.env.REDIS_KEY_PREFIX + parts.join(':');
}
