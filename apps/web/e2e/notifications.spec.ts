// M6: notification history, unread badge and settings, against the real API.
import { expect, test, type Page } from '@playwright/test';
import { API, registerViaApi, WEB } from './helpers';

async function freshUser(page: Page) {
  await page.context().clearCookies();
  await registerViaApi(page.request, 'Notify E2E');
}

const sendTest = (page: Page) => page.request.post(`${API}/notifications/test`, { headers: { origin: WEB } });

test('a new notification shows up live in the bell, the history, and can be marked read', async ({
  page,
}) => {
  await freshUser(page);
  await page.goto('/');
  const bell = page.getByTestId('notification-bell').filter({ visible: true });
  await expect(bell).toHaveAccessibleName('Notifications');

  expect((await sendTest(page)).status()).toBe(200);
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');

  await bell.click();
  await expect(page).toHaveURL(/\/notifications$/);
  const row = page.getByTestId('notification');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Pocket Agent test notification');
  await expect(row).toHaveAttribute('data-unread', 'true');

  await page.getByTestId('mark-all-read').click();
  await expect(row).not.toHaveAttribute('data-unread');
  await expect(bell).toHaveAccessibleName('Notifications');
});

test('empty history explains what will appear', async ({ page }) => {
  await freshUser(page);
  await page.goto('/notifications');
  await expect(page.getByTestId('no-notifications')).toBeVisible();
});

test('category and quiet-hour settings persist', async ({ page }) => {
  await freshUser(page);
  await page.goto('/profile');
  const started = page.getByTestId('category-agent_started');
  await expect(started).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('category-permission_required')).toHaveAttribute('aria-checked', 'true');
  await started.click();
  await expect(started).toHaveAttribute('aria-checked', 'true');

  const quiet = page.getByTestId('quiet-switch');
  await quiet.click();
  await expect(quiet).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('quiet-timezone')).toContainText('Time zone:');
  await page.getByTestId('quiet-start').fill('23:15');
  await page.getByTestId('quiet-save').click();
  await expect(page.getByTestId('quiet-save')).toBeEnabled();

  await page.reload();
  await expect(page.getByTestId('category-agent_started')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('quiet-switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('quiet-start')).toHaveValue('23:15');

  // The device panel always says what push can do here (never a dead button).
  await expect(page.getByTestId('push-this-device')).toBeVisible();
});

test('the app is installable: manifest and icons are served', async ({ request }) => {
  const m = await request.get(`${WEB}/manifest.webmanifest`);
  expect(m.status()).toBe(200);
  const manifest = (await m.json()) as { display: string; icons: Array<{ src: string }> };
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const r = await request.get(`${WEB}${icon.src}`);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  const sw = await request.get(`${WEB}/sw.js`);
  expect(sw.status()).toBe(200);
});
