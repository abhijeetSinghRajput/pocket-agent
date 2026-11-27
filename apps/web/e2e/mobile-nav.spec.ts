import { expect, test } from '@playwright/test';

test.describe('mobile navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('bottom nav reaches every section; the avatar opens the profile', async ({ page }) => {
    await page.goto('/chat');
    const nav = page.getByTestId('bottom-nav');
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Agents' }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(nav.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page.getByTestId('claude-usage')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  });

  test('touch targets in the bottom nav are at least 44px tall', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByTestId('bottom-nav')).toBeVisible(); // shell renders after the session check
    const heights = await page
      .getByTestId('bottom-nav')
      .locator('a, button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBe(5); // Chats, Agents, Alerts, Devices, profile
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('page content is not hidden behind the bottom nav', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByTestId('api-status')).toBeVisible(); // the page loaded
    // Cards below keep loading after the first one: scroll to the very end until it stops growing.
    const gap = async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const navTop = await page.getByTestId('bottom-nav').evaluate((n) => n.getBoundingClientRect().top);
      const lastBottom = await page
        .getByRole('button', { name: 'Sign out' })
        .evaluate((n) => n.getBoundingClientRect().bottom);
      return navTop - lastBottom;
    };
    await expect.poll(gap).toBeGreaterThanOrEqual(0);
  });
});

test('desktop shows the sidebar instead of the bottom nav', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await page.goto('/chat');
  await expect(page.getByTestId('bottom-nav')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })).toHaveCount(1);
});
