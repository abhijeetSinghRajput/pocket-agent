#!/usr/bin/env node
// Publishes the APK built by `npm run apk` so the app can update itself: uploads it as
// `pocket-agent.apk` with `latest.json` (version, size, MD5) to the `mobile-preview` release. The
// app compares the version, downloads the APK, checks size and MD5, then Android checks the
// signature and asks before installing.
//
//   npm run release:apk -- "What's new, one line per change"
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const REPO = 'abhijeetSinghRajput/pocket-agent';
const TAG = 'mobile-preview';
const config = readFileSync(path.join(root, 'app.config.ts'), 'utf8');
const versionName = /version: '([^']+)'/.exec(config)?.[1];
const versionCode = Number(/versionCode: (\d+)/.exec(config)?.[1]);
if (!versionName || !versionCode) throw new Error('No version / versionCode in app.config.ts');

const built = path.join(root, 'dist', `pocket-agent-${versionName}.apk`);
const data = readFileSync(built);
const tmp = os.tmpdir();
const apk = path.join(tmp, 'pocket-agent.apk');
copyFileSync(built, apk);
const latest = {
  versionName,
  versionCode,
  url: `https://github.com/${REPO}/releases/download/${TAG}/pocket-agent.apk`,
  size: statSync(built).size,
  md5: createHash('md5').update(data).digest('hex'),
  sha256: createHash('sha256').update(data).digest('hex'),
  notes: process.argv.slice(2).join(' ').trim() || undefined,
};
const json = path.join(tmp, 'latest.json');
writeFileSync(json, JSON.stringify(latest, null, 2));
// The APK first: an app that reads the new latest.json before the new APK is there would find a
// mismatch and install nothing (it never installs a file that doesn't match).
execFileSync('gh', ['release', 'upload', TAG, apk, '--clobber', '--repo', REPO], { stdio: 'inherit' });
execFileSync('gh', ['release', 'upload', TAG, json, '--clobber', '--repo', REPO], { stdio: 'inherit' });
console.log(`Published ${versionName} (${versionCode}), ${latest.size} bytes, md5 ${latest.md5}`);
