import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env automatically. Load it for local development only;
// in deployed environments DATABASE_URL comes from the real environment.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
