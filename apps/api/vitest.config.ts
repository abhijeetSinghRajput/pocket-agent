import { defineConfig } from 'vitest/config';

// Unit tests: no external services required.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/**/*.int.test.ts'] } });
