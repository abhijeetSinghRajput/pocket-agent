import { execFile } from 'node:child_process';

/**
 * Starts the agent when the user signs in to Windows, via the per-user "Run" registry key
 * (HKCU — no administrator rights, removed cleanly by `autostart disable`). Other platforms are not
 * supported yet.
 */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const AUTOSTART_VALUE = 'PocketAgent';

export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const run: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout) });
    });
  });

export const autostartSupported = (platform = process.platform) => platform === 'win32';

/** The command Windows runs at sign-in. */
export function autostartCommand(nodePath: string, cliPath: string): string {
  return `"${nodePath}" "${cliPath}" start --background`;
}

export async function enableAutostart(command: string, runner: Runner = run, name = AUTOSTART_VALUE) {
  const r = await runner('reg', ['add', RUN_KEY, '/v', name, '/t', 'REG_SZ', '/d', command, '/f']);
  if (r.code !== 0) throw new Error('Could not register Pocket Agent to start at sign-in.');
}

export async function disableAutostart(runner: Runner = run, name = AUTOSTART_VALUE): Promise<boolean> {
  if (!(await autostartCommandRegistered(runner, name))) return false;
  const r = await runner('reg', ['delete', RUN_KEY, '/v', name, '/f']);
  if (r.code !== 0) throw new Error('Could not remove the sign-in entry.');
  return true;
}

/** The registered command, or null. */
export async function autostartCommandRegistered(runner: Runner = run, name = AUTOSTART_VALUE) {
  const r = await runner('reg', ['query', RUN_KEY, '/v', name]);
  if (r.code !== 0) return null;
  const line = r.stdout.split(/\r?\n/).find((l) => l.trim().startsWith(name));
  const m = line?.match(/REG_SZ\s+(.*)$/);
  return m ? m[1]!.trim() : null;
}
