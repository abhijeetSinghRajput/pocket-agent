import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autostartCommand,
  autostartCommandRegistered,
  disableAutostart,
  enableAutostart,
  type Runner,
} from '../src/autostart.js';
import {
  clearPidFileSync,
  isEphemeralInstall,
  pidFile,
  runningPid,
  writePidFile,
} from '../src/background.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'pocket-agent-bg-'));
  dirs.push(d);
  return d;
};

describe('background PID file', () => {
  it('ignores missing, garbage, our own and dead PIDs', async () => {
    const home = await tmp();
    expect(await runningPid(home)).toBeNull();
    await writeFile(pidFile(home), 'not-a-pid');
    expect(await runningPid(home)).toBeNull();
    await writePidFile(home); // our own PID: not "another" agent
    expect(await runningPid(home)).toBeNull();
    await writeFile(pidFile(home), '999999'); // almost certainly not running
    expect(await runningPid(home)).toBeNull();
  });

  it('reports another live process', async () => {
    const home = await tmp();
    await writeFile(pidFile(home), String(process.ppid));
    expect(await runningPid(home)).toBe(process.ppid);
  });

  it('only removes a PID file it owns', async () => {
    const home = await tmp();
    await writeFile(pidFile(home), '12345');
    clearPidFileSync(home);
    expect(await readFile(pidFile(home), 'utf8')).toBe('12345');
    await writePidFile(home);
    clearPidFileSync(home);
    await expect(readFile(pidFile(home), 'utf8')).rejects.toThrow();
  });

  it('recognizes npx temporary installs', () => {
    expect(
      isEphemeralInstall(String.raw`C:\Users\u\AppData\Local\npm-cache\_npx\ab12\node_modules\x\dist\cli.js`),
    ).toBe(true);
    expect(isEphemeralInstall('/home/u/.npm/_npx/ab12/node_modules/x/dist/cli.js')).toBe(true);
    expect(isEphemeralInstall(String.raw`C:\Users\u\AppData\Roaming\npm\node_modules\x\dist\cli.js`)).toBe(
      false,
    );
  });
});

describe('Windows start at sign-in', () => {
  /** Fake reg.exe with an in-memory Run key. */
  function fakeReg() {
    const values = new Map<string, string>();
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args);
      const name = args[args.indexOf('/v') + 1]!;
      if (args[0] === 'add') {
        values.set(name, args[args.indexOf('/d') + 1]!);
        return { code: 0, stdout: 'The operation completed successfully.' };
      }
      if (args[0] === 'query') {
        const v = values.get(name);
        return v
          ? { code: 0, stdout: `\r\nHKEY_CURRENT_USER\\...\\Run\r\n    ${name}    REG_SZ    ${v}\r\n\r\n` }
          : { code: 1, stdout: '' };
      }
      if (args[0] === 'delete') return { code: values.delete(name) ? 0 : 1, stdout: '' };
      return { code: 1, stdout: '' };
    };
    return { runner, values, calls };
  }

  it('registers a quoted background start command under HKCU, reads it back and removes it', async () => {
    const reg = fakeReg();
    const cmd = autostartCommand(
      String.raw`C:\Program Files\nodejs\node.exe`,
      String.raw`C:\Users\a b\npm\cli.js`,
    );
    expect(cmd).toBe(
      String.raw`"C:\Program Files\nodejs\node.exe" "C:\Users\a b\npm\cli.js" start --background`,
    );

    await enableAutostart(cmd, reg.runner);
    expect(reg.calls[0]!.slice(0, 2)).toEqual([
      'add',
      String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
    ]);
    expect(await autostartCommandRegistered(reg.runner)).toBe(cmd);

    expect(await disableAutostart(reg.runner)).toBe(true);
    expect(await autostartCommandRegistered(reg.runner)).toBeNull();
    expect(await disableAutostart(reg.runner)).toBe(false);
  });

  it('reports failure to register', async () => {
    await expect(enableAutostart('x', async () => ({ code: 1, stdout: '' }))).rejects.toThrow(
      'start at sign-in',
    );
  });
});
