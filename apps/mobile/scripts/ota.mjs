#!/usr/bin/env node
// Publishes the app's code as an over-the-air update, signed with our key (keys/private-key.pem,
// never committed). Phones running a build with the same native fingerprint download it at their
// next start; any other build ignores it. Expo rolls back an update that fails to start.
//
//   npm run ota -- "What changed"
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { releaseEnv } from './release-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const key = path.join(root, 'keys', 'private-key.pem');
if (!existsSync(key)) throw new Error('No signing key at keys/private-key.pem: updates must be signed.');
const message = process.argv.slice(2).join(' ').trim() || 'Update';
execFileSync(
  'npx',
  [
    'eas-cli@latest',
    'update',
    '--channel',
    'production',
    // Expo's variables for production (none: the app's settings come from release-env.mjs).
    '--environment',
    'production',
    '--platform',
    'android',
    '--private-key-path',
    key,
    '--message',
    JSON.stringify(message),
    '--non-interactive',
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: releaseEnv() },
);
