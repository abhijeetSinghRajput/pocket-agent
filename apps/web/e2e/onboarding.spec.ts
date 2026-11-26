import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers';

// A fresh browser, and an account without a PC.
test.use({ storageState: { cookies: [], origins: [] } });

test('an account without a PC only sees the setup screen, with one command to run', async ({ page }) => {
  await registerViaApi(page.request, 'Onboarding E2E');
  for (const path of ['/chat', '/devices', '/approvals']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Let’s connect your PC.');
  }
  await expect(page.getByTestId('onboarding-status')).toContainText('Not connected');
  await page.getByTestId('onboarding-connect').click();
  const code = (await page.getByTestId('pairing-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{6}$/);
  await expect(page.getByTestId('pairing-command')).toContainText(`pocket-agent connect ${code}`);
  await expect(page.getByTestId('install-command')).toHaveText('npm install -g @mrcodium/pocket-agent');
  await expect(page.getByTestId('onboarding-status')).toContainText('Waiting for your PC');
  await expect(page.getByText('Set up later')).toHaveCount(0);
});
