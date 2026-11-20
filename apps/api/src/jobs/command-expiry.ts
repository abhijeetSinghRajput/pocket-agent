import type { FastifyInstance } from 'fastify';
import { expireApprovals } from '../approvals/service.js';
import { expireCommands, type Services } from '../commands/service.js';

export async function commandExpiryJob(
  app: FastifyInstance,
  ctx: Services & { commandSweepMs?: number },
): Promise<void> {
  const timer = setInterval(() => {
    void expireCommands(ctx).catch((err: unknown) => app.log.warn({ err }, 'command expiry failed'));
    void expireApprovals(ctx).catch((err: unknown) => app.log.warn({ err }, 'approval expiry failed'));
  }, ctx.commandSweepMs ?? 10_000);
  app.addHook('onClose', async () => clearInterval(timer));
}
