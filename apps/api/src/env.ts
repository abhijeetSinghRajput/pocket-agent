import { z } from 'zod';

const LogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: LogLevel.default('info'),
  DATABASE_URL: z
    .string()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// URL'),
  REDIS_URL: z.string().refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// or rediss:// URL'),
  WEB_ORIGINS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  /** Prefix for every Redis key, so environments/tests can share one Redis safely. */
  REDIS_KEY_PREFIX: z.string().default('pocket-agent:'),
  /** Agent events older than this are deleted (audit logs are kept). */
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /**
   * Firebase service-account JSON file for sending web push (FCM HTTP v1). Optional: without it,
   * notifications are still recorded and shown in the app, just not pushed. Keep the file outside
   * the repository; it is a secret.
   */
  FCM_SERVICE_ACCOUNT_FILE: z.string().min(1).optional(),
  /**
   * Firebase project whose Auth issues "Sign in with Google" ID tokens. Optional: without it,
   * Google sign-in is off and only email + password work. Not a secret.
   */
  FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z0-9-]{4,40}$/)
    .optional(),
  /**
   * Where photos and PDFs sent with messages are stored: `cloudinary://<key>:<secret>@<cloud>`.
   * A secret. Optional: without it, attachments are off (messages stay text only).
   */
  CLOUDINARY_URL: z
    .string()
    .regex(/^cloudinary:\/\/\d+:[A-Za-z0-9_-]+@[a-z0-9-]+$/)
    .optional(),
  /** Absolute lifetime of a browser login session. */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Defaults to true in production. Only set false for plain-http local development. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Multiplies every per-IP rate limit. Production may only tighten (≤ 1); E2E raises it. */
  RATE_LIMIT_SCALE: z.coerce.number().min(0.01).max(1000).default(1),
  /** Set false to close sign-ups (e.g. a self-hosted single-user install). */
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Parent domain for the session cookie in production (e.g. ".pocket-agent.app"); unset = host-only. */
  COOKIE_DOMAIN: z.string().optional(),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

/** Parses and validates configuration. Error messages name the variable, never its value. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const env = {
    ...result.data,
    COOKIE_SECURE: result.data.COOKIE_SECURE ?? result.data.NODE_ENV === 'production',
  };
  if (env.NODE_ENV === 'production') {
    const insecure = env.WEB_ORIGINS.filter((o) => !o.startsWith('https://'));
    if (insecure.length) throw new EnvError([`WEB_ORIGINS: production origins must use https`]);
    if (!env.COOKIE_SECURE) throw new EnvError(['COOKIE_SECURE: cannot be false in production']);
    if (env.RATE_LIMIT_SCALE > 1)
      throw new EnvError(['RATE_LIMIT_SCALE: cannot loosen limits in production']);
  }
  return env;
}
