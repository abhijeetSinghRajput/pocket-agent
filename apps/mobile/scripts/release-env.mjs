// The environment every release is made with: the APK build and the over-the-air updates must use
// the same one (the API address is built into both).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const releaseEnv = () => ({
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://pocket-agent-api.onrender.com',
  GOOGLE_SERVICES_JSON: './google-services.json',
});

/**
 * A fingerprint of the app's native parts (modules, plugins, permissions, native config). Recorded
 * with each APK; an over-the-air update is refused when it differs (the update would need a new APK).
 */
export function nativeFingerprint() {
  const root = path.resolve(import.meta.dirname, '..');
  const out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', 'android'], {
    cwd: root,
    env: releaseEnv(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).hash;
}
