import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, registerViaApi, uniqueEmail } from './helpers';

// These flows start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

async function openAccountMenu(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByTestId('bottom-nav').getByRole('button', { name: 'More' }).click();
}

test('signed-out visitors are sent to sign-in and returned to where they were going', async ({
  page,
  request,
}) => {
  const { email } = await registerViaApi(request); // separate context: page stays signed out
  await page.goto('/devices');
  await expect(page).toHaveURL(/\/login\?next=%2Fdevices$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
});

test('register through the UI, then sign out', async ({ page, isMobile }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('Grace Hopper');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  await openAccountMenu(page, isMobile);
  await expect(page.getByText('Grace Hopper').filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);

  // The session is gone server-side: protected pages bounce back to sign-in.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('shows field validation and a generic error for wrong credentials', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('x');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('form-error')).toHaveText('Incorrect email or password');
});

test('the post-login redirect cannot leave Pocket Agent', async ({ page, request }) => {
  const { email } = await registerViaApi(request);
  await page.goto('/login?next=//evil.example/phish');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  expect(new URL(page.url()).host).toBe('localhost:3000');
});
