#!/usr/bin/env node
// Sends every phone on this app version back to the code inside its APK: publishes a signed
// "roll back to embedded" directive in place of the version's update manifest. Use it when an
// update is bad but doesn't crash at once (a crash at start is rolled back on the phone itself).
// Publishing a fixed update afterwards (`npm run ota`) moves the phones on again.
//
//   npm run ota:rollback            (the version in app.config.ts)
//   npm run ota:rollback -- 2.4.1
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const REPO = 'abhijeetSinghRajput/pocket-agent';
const key = path.join(root, 'keys', 'private-key.pem');
if (!existsSync(key))
  throw new Error('No signing key at keys/private-key.pem: a rollback must be signed too.');
const version =
  process.argv[2] ?? /version: '([^']+)'/.exec(readFileSync(path.join(root, 'app.config.ts'), 'utf8'))?.[1];
if (!version) throw new Error('Which version?');

const body = JSON.stringify({
  type: 'rollBackToEmbedded',
  parameters: { commitTime: new Date().toISOString() },
});
const signature = createSign('RSA-SHA256').update(body, 'utf8').sign(readFileSync(key, 'utf8'), 'base64');
const file = path.join(os.tmpdir(), `manifest-${version}.json`);
writeFileSync(file, JSON.stringify({ kind: 'directive', body, signature }));
execFileSync('gh', ['release', 'upload', 'ota-updates', file, '--clobber', '--repo', REPO], {
  stdio: 'inherit',
});
console.log(`Phones on ${version} go back to the code inside their APK at their next start.`);
