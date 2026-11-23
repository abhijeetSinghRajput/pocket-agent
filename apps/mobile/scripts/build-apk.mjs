#!/usr/bin/env node
// Builds the release APK on this PC, signed with the same key as the EAS cloud builds, so it
// installs over the app already on the phone and Google sign-in keeps working.
//
//   npm run apk            → dist/pocket-agent-<version>.apk
//
// Needs: JDK 17 and the Android SDK (JAVA_HOME / ANDROID_HOME), credentials.json + the keystore
// from `eas credentials` (never committed), google-services.json. Windows: long paths enabled.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts });

const creds = JSON.parse(readFileSync(path.join(root, 'credentials.json'), 'utf8')).android?.keystore;
if (!creds) throw new Error('credentials.json has no android keystore: run `eas credentials -p android` → download');
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://pocket-agent-api.onrender.com',
  GOOGLE_SERVICES_JSON: './google-services.json',
};

// 1. Native project from app.config.ts (only when the native setup changed; `--clean` to force).
if (process.argv.includes('--clean') || !existsSync(path.join(root, 'android'))) {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], { env });
}

// 2. Sign the release build with the EAS key; newer CMake (its ninja handles long Windows paths).
const gradleFile = path.join(root, 'android', 'app', 'build.gradle');
let gradle = readFileSync(gradleFile, 'utf8');
if (!gradle.includes('pocketAgentRelease')) {
  const store = path.join(root, creds.keystorePath).replaceAll('\\', '/');
  gradle = gradle
    .replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        pocketAgentRelease {
            storeFile file('${store}')
            storePassword '${creds.keystorePassword}'
            keyAlias '${creds.keyAlias}'
            keyPassword '${creds.keyPassword}'
        }
`,
    )
    .replace(
      /(release \{[^}]*?)signingConfig signingConfigs\.debug/s,
      '$1signingConfig signingConfigs.pocketAgentRelease',
    )
    .replace(/\nandroid \{\n/, '\nandroid {\n    externalNativeBuild { cmake { version "4.1.2" } }\n');
  writeFileSync(gradleFile, gradle);
}

// 3. Build. Phones are arm64; x86_64 is for the emulator.
run(win ? path.join(root, 'android', 'gradlew.bat') : './gradlew', ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a,x86_64'], {
  cwd: path.join(root, 'android'),
  env,
});

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `pocket-agent-${version}.apk`);
copyFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), out);
console.log(`\nAPK: ${out}`);
