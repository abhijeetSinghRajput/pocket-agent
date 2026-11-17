// Points integration tests at a dedicated database (…/agentdock_test) and applies migrations.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function testDatabaseUrl(): string {
  if (!process.env['DATABASE_URL'] && existsSync('.env')) process.loadEnvFile('.env');
  const base = process.env['DATABASE_URL'];
  if (!base) throw new Error('DATABASE_URL is required for integration tests');
  const url = new URL(base);
  url.pathname = '/agentdock_test';
  return url.toString();
}

export default function setup(): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
