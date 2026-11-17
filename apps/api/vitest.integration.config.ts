import { defineConfig } from 'vitest/config';

// Integration tests: require `pnpm infra:up` and applied migrations.
export default defineConfig({ test: { include: ['test/**/*.int.test.ts'], testTimeout: 20_000 } });
