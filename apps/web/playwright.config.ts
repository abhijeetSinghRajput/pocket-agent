import { defineConfig, devices } from '@playwright/test';

export const WEB = 'http://localhost:3000';
export const API = 'http://localhost:4000';
export const AUTH_FILE = 'e2e/.auth/user.json';

// Runs against the real API (requires `pnpm infra:up` + migrations), a production web build and the
// real Local Agent CLI (built by the root `pnpm test:e2e`).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], storageState: AUTH_FILE }, dependencies: ['setup'] },
    // Narrowest common phone width, emulated in Chromium.
    {
      name: 'mobile-narrow',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @agentdock/api start:dev',
      url: `${API}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Many registrations/pairings from one IP in a short run; production limits are unaffected.
      env: { RATE_LIMIT_SCALE: '50', LOG_LEVEL: 'warn' },
    },
    {
      command: 'pnpm build && pnpm start',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
