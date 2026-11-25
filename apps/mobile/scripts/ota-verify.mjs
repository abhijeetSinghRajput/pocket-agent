#!/usr/bin/env node
// Checks a published over-the-air update the way the phone does: asks the API for the update of
// a version, verifies the manifest's signature with the app's certificate (certs/certificate.pem),
// then downloads every file and checks its SHA-256. Reads only.
//
//   npm run ota:verify               (the version in app.config.ts)
//   npm run ota:verify -- 2.4.1
import { createHash, createVerify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { releaseEnv } from './release-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const version =
  process.argv[2] ?? /version: '([^']+)'/.exec(readFileSync(path.join(root, 'app.config.ts'), 'utf8'))?.[1];
const api = releaseEnv().EXPO_PUBLIC_API_URL;
const cert = new X509Certificate(readFileSync(path.join(root, 'certs', 'certificate.pem')));

const res = await fetch(`${api}/updates/manifest`, {
  headers: {
    'expo-protocol-version': '1',
    'expo-platform': 'android',
    'expo-runtime-version': version,
    'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    accept: 'multipart/mixed',
  },
});
console.log(`API answered ${res.status} for ${version}`);
if (res.status === 204) process.exit(0);
if (!res.ok) process.exit(1);
const boundary = /boundary=([^;]+)/.exec(res.headers.get('content-type') ?? '')?.[1];
const parts = (await res.text())
  .split(`--${boundary}`)
  .slice(1, -1)
  .map((raw) => {
    const [head, ...rest] = raw.replace(/^\r\n/, '').split('\r\n\r\n');
    return { head, body: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
  });
const part = parts.find((p) => /name="(manifest|directive)"/.test(p.head));
const sig = /sig="([^"]+)"/.exec(part?.head ?? '')?.[1];
const ok =
  !!sig && createVerify('RSA-SHA256').update(part.body, 'utf8').verify(cert.publicKey, sig, 'base64');
console.log(`Signature with the app's certificate: ${ok ? 'valid' : 'INVALID'}`);
if (!ok) process.exit(1);
const m = JSON.parse(part.body);
if (m.type) {
  console.log(`Directive: ${m.type}`);
  process.exit(0);
}
console.log(
  `Update ${m.id} for ${m.runtimeVersion} (${m.metadata?.message ?? ''}), ${m.assets.length + 1} files`,
);
let bad = 0;
for (const a of [m.launchAsset, ...m.assets]) {
  const data = Buffer.from(await (await fetch(a.url)).arrayBuffer());
  const hash = createHash('sha256').update(data).digest('base64url');
  if (hash !== a.hash) {
    bad++;
    console.log(`  hash mismatch: ${a.url}`);
  }
}
console.log(bad ? `${bad} file(s) don't match` : 'Every file matches its hash.');
process.exit(bad ? 1 : 0);
