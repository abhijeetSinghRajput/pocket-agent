import { test as setup } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerViaApi } from './helpers';

const AUTH_FILE = 'e2e/.auth/user.json';

/** One signed-in user shared by the read-only UI tests. Flow-specific tests create their own users. */
setup('create signed-in user', async ({ request }) => {
  const creds = await registerViaApi(request);
  mkdirSync('e2e/.auth', { recursive: true });
  await request.storageState({ path: AUTH_FILE });
  // The shared user has no PC: skip the first-run setup screen so tests land in the app itself
  // (onboarding.spec.ts covers that screen with a fresh browser).
  const state = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as { origins?: unknown[] };
  state.origins = [
    {
      origin: 'http://localhost:3000',
      localStorage: [{ name: 'pocket-agent:onboarding-skipped', value: '1' }],
    },
  ];
  writeFileSync(AUTH_FILE, JSON.stringify(state));
  writeFileSync('e2e/.auth/user-credentials.json', JSON.stringify(creds));
});
