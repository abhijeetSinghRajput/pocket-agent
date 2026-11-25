#!/usr/bin/env node
// Publishes the app's code as an over-the-air update, served by Pocket Agent's API
// (apps/api/src/routes/updates.ts) in Expo's update protocol, without Expo's hosting.
//
//   npm run ota -- "What changed"            (refuses if native parts changed since the APK)
//   npm run ota -- --force "What changed"    (after checking that the change is code only)
//
// 1. Bundles the code (`expo export`) with the same environment as the APK.
// 2. Uploads its files (bundle, images, fonts) to the GitHub release `ota-assets`, named by
//    content; files already there are reused.
// 3. Writes the manifest (files with their SHA-256), signs it with keys/private-key.pem on this
//    PC, and publishes it as `manifest-<version>.json` on the release `ota-updates` — last, so a
//    phone never sees a manifest whose files aren't there yet.
// Phones on that app version download it at their next start, check the signature against the
// certificate they were built with and every file's hash, and use it from the next start.
import { createHash, createSign, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeFingerprint, releaseEnv } from './release-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const REPO = 'abhijeetSinghRajput/pocket-agent';
const ASSETS = 'ota-assets';
const MANIFESTS = 'ota-updates';
const key = path.join(root, 'keys', 'private-key.pem');
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, shell: win, encoding: 'utf8', ...opts });
// gh is a plain program: no shell (a shell would split text with spaces and quotes).
const gh = (args, opts = {}) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', ...opts });

const args = process.argv.slice(2);
const force = args.includes('--force');
const message =
  args
    .filter((a) => a !== '--force')
    .join(' ')
    .trim() || 'Update';
if (!existsSync(key)) throw new Error('No signing key at keys/private-key.pem: updates must be signed.');

const config = readFileSync(path.join(root, 'app.config.ts'), 'utf8');
const version = /version: '([^']+)'/.exec(config)?.[1];
if (!version) throw new Error('No version in app.config.ts');

// Guard: an update may only change code. Native parts changed since this version's APK → refuse.
const built = path.join(root, 'dist', `native-fingerprint-${version}.json`);
const now = nativeFingerprint();
if (!existsSync(built)) {
  if (!force)
    throw new Error(`No APK of ${version} built on this PC to compare with. Build it first, or --force.`);
} else if (JSON.parse(readFileSync(built, 'utf8')).fingerprint !== now && !force) {
  throw new Error(
    `Native parts changed since the ${version} APK: release a new APK (bump the version) instead,\n` +
      'or, if you have checked that only code changed, run again with --force.',
  );
}

const env = releaseEnv();
const out = path.join(os.tmpdir(), `pocket-agent-ota-${Date.now()}`);
console.log(`Bundling ${version}…`);
run('npx', ['expo', 'export', '--platform', 'android', '--output-dir', out], { env, stdio: 'inherit' });
const expoClient = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json'], { env }));
const meta = JSON.parse(readFileSync(path.join(out, 'metadata.json'), 'utf8')).fileMetadata.android;

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  svg: 'image/svg+xml',
};
const base64url = (b) => b.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const url = (name) => `https://github.com/${REPO}/releases/download/${ASSETS}/${name}`;
const files = [];
const describe = (rel, ext, launch) => {
  const data = readFileSync(path.join(out, rel));
  const md5 = createHash('md5').update(data).digest('hex');
  const name = `${md5}.${launch ? 'bundle' : ext}`;
  files.push({ src: path.join(out, rel), name });
  return {
    hash: base64url(createHash('sha256').update(data).digest()),
    key: md5,
    contentType: launch ? 'application/javascript' : (MIME[ext] ?? 'application/octet-stream'),
    fileExtension: launch ? '.bundle' : `.${ext}`,
    url: url(name),
  };
};
const launchAsset = describe(meta.bundle, 'bundle', true);
const assets = meta.assets.map((a) => describe(a.path, a.ext, false));

// Releases that hold the files and the manifests (made once).
const ensure = (tag, notes) => {
  try {
    gh(['release', 'view', tag, '--repo', REPO, '--json', 'tagName']);
  } catch {
    gh(['release', 'create', tag, '--repo', REPO, '--prerelease', '--title', tag, '--notes', notes]);
  }
};
ensure(
  ASSETS,
  "Files of the app's over-the-air updates, named by content (MD5). Used by the app; checked by SHA-256.",
);
ensure(MANIFESTS, "Signed manifests of the app's over-the-air updates, one per app version.");

const have = new Set(
  JSON.parse(gh(['release', 'view', ASSETS, '--repo', REPO, '--json', 'assets'])).assets.map((a) => a.name),
);
const upload = path.join(out, '_upload');
mkdirSync(upload, { recursive: true });
const missing = files.filter((f) => !have.has(f.name));
for (const f of missing) copyFileSync(f.src, path.join(upload, f.name));
if (missing.length) {
  console.log(`Uploading ${missing.length} new file(s) (${files.length - missing.length} reused)…`);
  gh(['release', 'upload', ASSETS, ...missing.map((f) => path.join(upload, f.name)), '--repo', REPO], {
    stdio: 'inherit',
  });
}

const manifest = JSON.stringify({
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  runtimeVersion: version,
  launchAsset,
  assets,
  metadata: { message },
  extra: { expoClient },
});
const signature = createSign('RSA-SHA256').update(manifest, 'utf8').sign(readFileSync(key, 'utf8'), 'base64');
const file = path.join(out, `manifest-${version}.json`);
writeFileSync(file, JSON.stringify({ kind: 'manifest', body: manifest, signature }));
gh(['release', 'upload', MANIFESTS, file, '--clobber', '--repo', REPO], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
console.log(`Published a signed update for ${version}: ${message}`);
