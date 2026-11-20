import { expect, test, type Page } from '@playwright/test';

const ROUTES = [
  { path: '/', heading: 'Overview' },
  { path: '/agents', heading: 'Agents' },
  { path: '/approvals', heading: 'Approvals' },
  { path: '/devices', heading: 'Devices' },
  { path: '/settings', heading: 'Settings' },
];

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const { path, heading } of ROUTES) {
  test(`${path} renders without horizontal overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('sections show real (empty) data, never mock data', async ({ page }) => {
  await page.goto('/approvals');
  await expect(page.getByTestId('no-approvals')).toContainText('pocket-agent approvals enable');
  await expect(page.getByTestId('approval-card')).toHaveCount(0);
  await page.goto('/notifications');
  await expect(page.getByTestId('notification')).toHaveCount(0);
  // No placeholders remain: every section is backed by the real API.
  await page.goto('/settings');
  await expect(page.getByTestId('notification-settings')).toBeVisible();
  await expect(page.getByText(/Arrives in M\d/)).toHaveCount(0);
});

test('overview shows real backend health', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('api-status');
  await expect(card.getByText('Operational')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Database')).toBeVisible();
  await expect(card.getByText('Redis')).toBeVisible();
});

test('theme toggle switches between light and dark and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);
  await page.getByTestId('theme-toggle').filter({ visible: true }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test('pressing D toggles the theme, but not while typing', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/agents');
  const html = page.locator('html');
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(html).not.toHaveClass(/dark/);
  await page.keyboard.press('d');
  await expect(html).toHaveClass(/dark/);
  await page.getByLabel('Search sessions').fill('d');
  await expect(html).toHaveClass(/dark/);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('d');
  await expect(html).not.toHaveClass(/dark/);
});
