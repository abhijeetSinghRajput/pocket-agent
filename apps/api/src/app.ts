import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { MAX_FRAME_BYTES } from '@pocket-agent/protocol';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppContext } from './context.js';
import type { Env } from './env.js';
import { agentGateway, type GatewayOptions } from './gateway/agent-gateway.js';
import { commandExpiryJob } from './jobs/command-expiry.js';
import { retentionJob } from './jobs/retention.js';
import { NO_PUSH, type PushSender } from './notifications/push.js';
import { offlineNotifierJob } from './notifications/triggers.js';
import { createBus } from './realtime/bus.js';
import { clientGateway } from './realtime/client-gateway.js';
import { approvalRoutes } from './routes/approvals.js';
import { attachmentRoutes } from './routes/attachments.js';
import { cloudinaryStorage, type AttachmentStorage } from './attachments/storage.js';
import { authRoutes } from './routes/auth.js';
import { firebaseGoogleVerifier, type GoogleVerifier } from './auth/firebase.js';
import { commandRoutes } from './routes/commands.js';
import { agentRoutes, deviceRoutes } from './routes/devices.js';
import { pairingAgentRoutes, pairingUserRoutes } from './routes/pairing.js';
import { healthRoutes, type HealthDeps } from './routes/health.js';
import { notificationRoutes } from './routes/notifications.js';
import { sessionRoutes } from './routes/sessions.js';
import { subagentRoutes } from './routes/subagents.js';

export interface AppDeps {
  env: Pick<Env, 'WEB_ORIGINS' | 'NODE_ENV'>;
  health: HealthDeps;
  logger?: FastifyServerOptions['logger'];
  /**
   * Database/Redis-backed features (auth, devices, agent gateway). Omitted only in unit tests that
   * exercise the HTTP shell (health, CORS, headers) without infrastructure.
   */
  ctx?: AppContext & GatewayOptions & { offlineCheckMs?: number };
  /** Web push sender (FCM). Defaults to none: notifications are recorded but not pushed. */
  push?: PushSender;
  /** Where attachments are stored. Defaults to Cloudinary when CLOUDINARY_URL is set, else off. */
  storage?: AttachmentStorage | null;
  /** Verifies "Sign in with Google" tokens. Defaults to Firebase Auth when FIREBASE_PROJECT_ID is set. */
  google?: GoogleVerifier | null;
  /**
   * Test-only escape hatch so functional tests from one IP aren't throttled. Refused outside
   * NODE_ENV=test; dedicated tests run with limits on.
   */
  disableRateLimits?: boolean;
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  app.decorateRequest('user', null);

  await app.register(healthRoutes, deps.health);

  const ctx = deps.ctx;
  if (deps.disableRateLimits && deps.env.NODE_ENV !== 'test') {
    throw new Error('disableRateLimits is only allowed when NODE_ENV=test');
  }
  if (ctx) {
    // Per-route limits (config.rateLimit). Counters live in Redis so they hold across instances.
    // If Redis is unavailable, rate-limited routes fail closed (500) rather than run unthrottled.
    await app.register(rateLimit, {
      global: false,
      redis: ctx.redis,
      nameSpace: `${ctx.env.REDIS_KEY_PREFIX}rl:`,
      skipOnError: false,
      ...(deps.disableRateLimits ? { allowList: () => true } : {}),
      errorResponseBuilder: (_req, c) => ({
        statusCode: 429,
        error: 'rate_limited',
        message: `Too many requests. Try again in ${Math.ceil(c.ttl / 1000)}s.`,
      }),
    });
    const google =
      deps.google !== undefined
        ? deps.google
        : ctx.env.FIREBASE_PROJECT_ID
          ? firebaseGoogleVerifier(ctx.env.FIREBASE_PROJECT_ID)
          : null;
    const storage =
      deps.storage !== undefined
        ? deps.storage
        : ctx.env.CLOUDINARY_URL
          ? cloudinaryStorage(ctx.env.CLOUDINARY_URL)
          : null;
    const services = { ...ctx, bus: createBus(ctx, app.log), push: deps.push ?? NO_PUSH, google };
    app.addHook('onClose', async () => services.bus.close());
    await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });
    await app.register(authRoutes, services);
    await app.register(deviceRoutes, services);
    await app.register(agentRoutes, services);
    await app.register(pairingAgentRoutes, services);
    await app.register(pairingUserRoutes, services);
    await app.register(sessionRoutes, services);
    await app.register(subagentRoutes, services);
    await app.register(agentGateway, services);
    await app.register(clientGateway, services);
    await app.register(retentionJob, services);
    await app.register(commandRoutes, services);
    await app.register(approvalRoutes, services);
    await app.register(commandExpiryJob, services);
    await app.register(notificationRoutes, services);
    await app.register(attachmentRoutes, { ...ctx, storage });
    await app.register(offlineNotifierJob, services);
  }

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err: unknown, req, reply) => {
    const e = (typeof err === 'object' && err !== null ? err : {}) as {
      statusCode?: number;
      code?: string;
      error?: string;
      message?: string;
    };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: e.message });
    // Never leak internals (stack traces, SQL) to clients.
    return reply.code(status).send({ error: status >= 500 ? 'internal_error' : (e.code ?? 'bad_request') });
  });

  return app;
}
