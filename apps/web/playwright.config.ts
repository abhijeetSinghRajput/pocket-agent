import { defineConfig, devices } from '@playwright/test';

export const WEB = 'http://localhost:3000';
export const API = 'http://localhost:4000';
export const AUTH_FILE = 'e2e/.auth/user.json';

/**
 * Specs that spawn real Local Agent processes (each start/pair also spawns PowerShell for DPAPI).
 * Running them alongside 8 parallel browsers starved this Windows dev machine and made unrelated
 * tests time out, so they run in their own phase after the UI suite, two at a time.
 */
const AGENT_SPECS = /(agents|pairing|control)\.spec\.ts/;

const desktop = { ...devices['Desktop Chrome'], storageState: AUTH_FILE };
const mobile = { ...devices['Pixel 7'], storageState: AUTH_FILE };

// Runs against the real API (requires `pnpm infra:up` + migrations), a production web build and the
// real Local Agent CLI (built by the root `pnpm test:e2e`).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One `next start` process serves every browser. With 8 browsers (desktop ones prefetch every
  // sidebar route) it fell several seconds behind on this machine; 4 keeps runs fast and stable.
  workers: 4,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    // Phase 1: UI behaviour on three form factors.
    { name: 'desktop', use: desktop, dependencies: ['setup'], testIgnore: AGENT_SPECS },
    { name: 'mobile', use: mobile, dependencies: ['setup'], testIgnore: AGENT_SPECS },
    {
      name: 'mobile-narrow',
      // Narrowest common phone width, emulated in Chromium.
      use: { ...mobile, viewport: { width: 360, height: 740 } },
      dependencies: ['setup'],
      testIgnore: AGENT_SPECS,
    },
    // Phase 2: full stack with real Local Agent processes.
    {
      name: 'desktop-agent',
      use: desktop,
      testMatch: AGENT_SPECS,
      dependencies: ['desktop', 'mobile', 'mobile-narrow'],
    },
    {
      name: 'mobile-agent',
      use: mobile,
      testMatch: AGENT_SPECS,
      dependencies: ['desktop', 'mobile', 'mobile-narrow'],
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
