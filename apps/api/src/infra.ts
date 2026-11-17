import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { PrismaClient } from './generated/prisma/client.js';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export function createRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    // Fail fast instead of queueing commands forever while Redis is down;
    // /health reports it as down and the client keeps reconnecting in the background.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
  });
}

export type { PrismaClient, Redis };
