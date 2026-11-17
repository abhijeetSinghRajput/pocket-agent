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
});

export type Env = z.infer<typeof EnvSchema>;

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
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const insecure = env.WEB_ORIGINS.filter((o) => !o.startsWith('https://'));
    if (insecure.length) throw new EnvError([`WEB_ORIGINS: production origins must use https`]);
  }
  return env;
}
