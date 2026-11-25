import { createRequire } from 'node:module';
import { buildApp } from './app.js';
import { EnvError, loadEnv } from './env.js';
import { createPrisma, createRedis } from './infra.js';
import { createFcmSender } from './notifications/push.js';

/** Hard limit on a graceful shutdown. */
const SHUTDOWN_DEADLINE_MS = 10_000;

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const prisma = createPrisma(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  redis.on('error', () => {
    /* surfaced via /health; ioredis keeps reconnecting */
  });
  redis.connect().catch(() => undefined);

  const app = await buildApp({
    env,
    updates: { base: env.OTA_MANIFEST_BASE },
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    health: {
      version,
      probes: {
        database: () => prisma.$queryRaw`SELECT 1`,
        redis: () => redis.ping(),
      },
    },
    ctx: { env, prisma, redis, now: () => new Date() },
    push: createFcmSender(env.FCM_SERVICE_ACCOUNT_FILE, (m) => console.warn(m)),
  });
  if (!env.FCM_SERVICE_ACCOUNT_FILE)
    app.log.info('web push not configured (FCM_SERVICE_ACCOUNT_FILE unset); notifications are in-app only');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    // Never hang: if closing stalls, exit anyway.
    setTimeout(() => {
      app.log.error('shutdown timed out');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    await app.close().catch((err: unknown) => app.log.error({ err }, 'close failed'));
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

void main();
