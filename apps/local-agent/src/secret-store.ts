import { execFile } from 'node:child_process';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Stores the device secret at rest.
 * - Windows: DPAPI (CurrentUser scope) via PowerShell. Only this Windows user on this machine can decrypt.
 *   The secret is passed on stdin, never on the command line (which other processes can read).
 * - Other platforms: file with 0600 permissions (OS keychain integration is future work).
 */
export interface SecretStore {
  save(secret: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

const ENTROPY = 'Pocket Agent-device-secret-v1';

function powershell(script: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()),
    );
    child.stdin!.end(stdin);
  });
}

const PROTECT = `Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd()
$data = [Text.Encoding]::UTF8.GetBytes($in)
$ent = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data, $ent, 'CurrentUser'))`;

const UNPROTECT = `Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$ent = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $ent, 'CurrentUser')
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))`;

export function createSecretStore(home: string, platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === 'win32') {
    const file = path.join(home, 'credentials.dpapi');
    return {
      async save(secret) {
        await writeFile(file, await powershell(PROTECT, secret), { encoding: 'utf8' });
      },
      async load() {
        const blob = await readFile(file, 'utf8').catch(() => null);
        return blob ? powershell(UNPROTECT, blob) : null;
      },
      async clear() {
        await rm(file, { force: true });
      },
    };
  }
  const file = path.join(home, 'credentials');
  return {
    async save(secret) {
      await writeFile(file, secret, { encoding: 'utf8', mode: 0o600 });
      await chmod(file, 0o600);
    },
    async load() {
      return (await readFile(file, 'utf8').catch(() => null))?.trim() || null;
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}
