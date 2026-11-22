import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers';

// A fresh browser: nothing remembered, so the first-run setup screen is shown.
test.use({ storageState: { cookies: [], origins: [] } });

test('a new account without a PC sees the setup screen first, and can skip it', async ({ page }) => {
  await registerViaApi(page.request, 'Onboarding E2E');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect your PC' })).toBeVisible();
  const code = (await page.getByTestId('pairing-code').textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByText(`pocket-agent connect ${code}`)).toBeVisible();
  await expect(page.getByTestId('onboarding-status')).toContainText('Waiting for your PC');

  await page.getByTestId('onboarding-skip').click();
  await expect(page.getByRole('heading', { name: 'Connect your PC' })).toHaveCount(0);

  // Remembered on this browser.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect your PC' })).toHaveCount(0);
});
