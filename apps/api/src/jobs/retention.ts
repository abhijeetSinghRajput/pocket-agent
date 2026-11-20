import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

const EVERY_MS = 6 * 60 * 60 * 1000;
const BATCH = 5_000;

/** Deletes agent events older than EVENT_RETENTION_DAYS, in batches. Audit logs are never pruned. */
export async function pruneEvents(ctx: AppContext): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - ctx.env.EVENT_RETENTION_DAYS * 86_400_000);
  let total = 0;
  for (;;) {
    const ids = await ctx.prisma.agentEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    if (!ids.length) return total;
    const r = await ctx.prisma.agentEvent.deleteMany({ where: { id: { in: ids.map((x) => x.id) } } });
    total += r.count;
  }
}

export async function retentionJob(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const run = () =>
    pruneEvents(ctx)
      .then((n) => n && app.log.info({ deleted: n }, 'pruned old agent events'))
      .catch((err: unknown) => app.log.warn({ err }, 'event retention failed'));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, EVERY_MS);
  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}
