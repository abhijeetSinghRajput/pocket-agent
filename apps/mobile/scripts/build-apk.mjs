#!/usr/bin/env node
// Builds the release APK on this PC, signed with the same key as the EAS cloud builds, so it
// installs over the app already on the phone and Google sign-in keeps working.
//
//   npm run apk               → dist/pocket-agent-<version>.apk (a few minutes: reuses what's built)
//   npm run apk -- --clean    → regenerates the native project and builds everything (~12 min):
//                               needed after a native change (a new module, plugin or permission)
//   npm run apk -- --emulator → also for the PC's Android emulator (x86_64)
//
// Needs: JDK 17 and the Android SDK (JAVA_HOME / ANDROID_HOME), credentials.json + the keystore
// from `eas credentials` (never committed), google-services.json. Windows: long paths enabled.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { releaseEnv } from './release-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts });

const creds = JSON.parse(readFileSync(path.join(root, 'credentials.json'), 'utf8')).android?.keystore;
if (!creds)
  throw new Error('credentials.json has no android keystore: run `eas credentials -p android` → download');
// The same environment as over-the-air updates (see release-env.mjs).
const env = releaseEnv();

// 1. Native project from app.config.ts, only with `--clean` (or none yet): Expo regenerates it from
// scratch each time, and then everything compiles again. Otherwise the existing one is reused and
// only the version is brought up to date (step 2).
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
// Room for the code generators (expo-updates' KSP ran out of Metaspace with the defaults).
const propsFile = path.join(root, 'android', 'gradle.properties');
const props = readFileSync(propsFile, 'utf8')
  .split(/\r?\n/)
  .filter((l) => !/^(org\.gradle\.jvmargs|kotlin\.daemon\.jvmargs)=/.test(l));
props.push(
  'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8',
  'kotlin.daemon.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=1024m',
);
writeFileSync(propsFile, props.filter(Boolean).join('\n') + '\n');

// The version from app.config.ts (versionName, versionCode), so a reused project is never stale.
const config = readFileSync(path.join(root, 'app.config.ts'), 'utf8');
const versionName = /version: '([^']+)'/.exec(config)?.[1];
const versionCode = /versionCode: (\d+)/.exec(config)?.[1];
if (versionName && versionCode) {
  const now = readFileSync(gradleFile, 'utf8');
  const next = now
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${versionName}"`);
  if (next !== now) writeFileSync(gradleFile, next);
}

// 3. Build. Phones are arm64; x86_64 (the emulator) only when asked: it doubles the native work.
const archs = process.argv.includes('--emulator') ? 'arm64-v8a,x86_64' : 'arm64-v8a';
run(
  win ? path.join(root, 'android', 'gradlew.bat') : './gradlew',
  ['assembleRelease', `-PreactNativeArchitectures=${archs}`],
  {
    cwd: path.join(root, 'android'),
    env,
  },
);

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `pocket-agent-${version}.apk`);
copyFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), out);
console.log(`\nAPK: ${out}`);
