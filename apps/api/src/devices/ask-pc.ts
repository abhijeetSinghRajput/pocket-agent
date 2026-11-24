import type { BackendToAgent } from '@pocket-agent/protocol';
import { redisKey, type AppContext } from '../context.js';
import { CHANNELS, type Bus } from '../realtime/bus.js';

/**
 * Questions the app asks a PC live (which folders are in a project, a session's sub-agents…):
 * the request goes to whichever API instance holds the PC's connection; that instance leaves the
 * PC's answer in Redis, where the waiting request reads it. Nothing is stored for longer.
 */

/** How long the app waits for the PC to answer. */
export const PC_ANSWER_WAIT_MS = 10_000;
const POLL_MS = 120;

const replyKey = (ctx: Pick<AppContext, 'env'>, requestId: string) => redisKey(ctx, 'pc-reply', requestId);

type Services = Pick<AppContext, 'env' | 'redis'> & { bus: Bus };

/** Whether the PC is connected right now (its status, and a live presence key). */
export async function pcOnline(
  ctx: Pick<AppContext, 'env' | 'redis'>,
  device: { id: string; status: string },
) {
  return (
    device.status === 'Online' &&
    (await ctx.redis.exists(redisKey(ctx, 'presence', device.id)).catch(() => 0)) === 1
  );
}

/** Sends `frame` (carrying `requestId`) to the PC and waits for its answer; null if none came. */
export async function askPc<T>(
  ctx: Services,
  deviceId: string,
  requestId: string,
  frame: BackendToAgent,
): Promise<T | null> {
  await ctx.bus.publish(CHANNELS.agentCommands, JSON.stringify({ deviceId, frame }));
  const key = replyKey(ctx, requestId);
  const deadline = Date.now() + PC_ANSWER_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const raw = await ctx.redis.get(key);
    if (!raw) continue;
    await ctx.redis.del(key).catch(() => undefined);
    return JSON.parse(raw) as T;
  }
  return null;
}

/** The PC answered (on the instance holding its connection): hand it to the waiting request. */
export async function pcAnswered(ctx: Pick<AppContext, 'env' | 'redis'>, requestId: string, answer: unknown) {
  await ctx.redis
    .set(replyKey(ctx, requestId), JSON.stringify(answer), 'PX', PC_ANSWER_WAIT_MS * 2)
    .catch(() => undefined);
}
