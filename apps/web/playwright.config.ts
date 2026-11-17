import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:3000';

// Runs against the real API (requires `pnpm infra:up` + migrations) and a production web build.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Narrowest common phone width, emulated in Chromium.
    { name: 'mobile-narrow', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @agentdock/api start:dev',
      url: 'http://localhost:4000/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm start',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
