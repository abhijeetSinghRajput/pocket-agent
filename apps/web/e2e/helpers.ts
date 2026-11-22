import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const WEB = 'http://localhost:3000';
export const API = 'http://localhost:4000';
export const PASSWORD = 'e2e-password-123';

export function uniqueEmail(): string {
  return `e2e-${randomUUID()}@test.invalid`;
}

/** Registers through the real API. With `page.request` the session cookie lands in the page's context. */
export async function registerViaApi(request: APIRequestContext, name = 'E2E User') {
  const email = uniqueEmail();
  const res = await request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name, email, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email, password: PASSWORD, name };
}

/**
 * Pairs a stand-in PC to the signed-in user straight through the API (no agent process), so the
 * app opens instead of the setup screen, which can't be skipped without a PC.
 */
export async function addFakePc(request: APIRequestContext, name = 'E2E Fake PC') {
  const res = await request.post(`${API}/devices/pairing-codes`, { headers: { origin: WEB } });
  expect(res.status(), await res.text()).toBe(201);
  const { code } = (await res.json()) as { code: string };
  const pair = await request.post(`${API}/devices/pair`, {
    data: { code, name, platform: 'windows', agentVersion: '0.1.5' },
  });
  expect(pair.status(), await pair.text()).toBe(201);
}

/** The open chat's live status badge (the session list next to it on desktop has its own). */
export const chatStatus = (page: import('@playwright/test').Page) =>
  page.getByTestId('chat-header').getByTestId('session-status');

/** Opens the chat's "Session info" panel and returns its capability list. */
export async function openSessionInfo(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-header').getByRole('button', { name: 'Session info' }).click();
  return page.getByTestId('session-info').getByTestId('capabilities');
}

export async function closeSessionInfo(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await page.getByTestId('session-info').waitFor({ state: 'detached' });
}
