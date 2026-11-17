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
