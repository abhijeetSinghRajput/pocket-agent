import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/global-setup.int.js';

// Integration tests: require `pnpm infra:up`. They use their own database (agentdock_test).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.int.ts'],
    env: { DATABASE_URL: testDatabaseUrl(), NODE_ENV: 'test' },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
