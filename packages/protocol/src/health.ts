import { z } from 'zod';

export const DependencyHealth = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof DependencyHealth>;

/** Response body of `GET /health` on the API. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('agentdock-api'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({ database: DependencyHealth, redis: DependencyHealth }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
