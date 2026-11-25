#!/usr/bin/env node
// Sends every phone back to the code inside its installed APK (undoes all over-the-air updates
// for the `production` channel). Signed like an update, so the app accepts it. Use it when an
// update is bad but doesn't crash at once (a crash at start is rolled back on the phone by Expo).
//
//   npm run ota:rollback
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { releaseEnv } from './release-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const key = path.join(root, 'keys', 'private-key.pem');
if (!existsSync(key))
  throw new Error('No signing key at keys/private-key.pem: a rollback must be signed too.');
execFileSync(
  'npx',
  [
    'eas-cli@latest',
    'update:roll-back-to-embedded',
    '--channel',
    'production',
    '--private-key-path',
    key,
    '--non-interactive',
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: releaseEnv() },
);
