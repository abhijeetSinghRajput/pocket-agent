import { test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { addFakePc, registerViaApi } from './helpers';

const AUTH_FILE = 'e2e/.auth/user.json';

/** One signed-in user shared by the read-only UI tests. Flow-specific tests create their own users. */
setup('create signed-in user', async ({ request }) => {
  const creds = await registerViaApi(request);
  // Without a PC the app only shows the setup screen (onboarding.spec.ts covers that).
  await addFakePc(request);
  mkdirSync('e2e/.auth', { recursive: true });
  await request.storageState({ path: AUTH_FILE });
  writeFileSync('e2e/.auth/user-credentials.json', JSON.stringify(creds));
});
