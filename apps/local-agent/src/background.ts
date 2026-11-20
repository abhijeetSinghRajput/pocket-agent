import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The running agent writes its PID here so a second start doesn't fight it for the connection. */
export const pidFile = (home: string) => path.join(home, 'agent.pid');
/** Output of an agent started in the background (by `start --background` or at login). */
export const logFile = (home: string) => path.join(home, 'agent.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** PID of a running agent for this state directory, or null. Stale PID files are ignored. */
export async function runningPid(home: string): Promise<number | null> {
  const raw = await readFile(pidFile(home), 'utf8').catch(() => null);
  const pid = raw ? Number.parseInt(raw.trim(), 10) : NaN;
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null;
  return isAlive(pid) ? pid : null;
}

export async function writePidFile(home: string, pid = process.pid): Promise<void> {
  await writeFile(pidFile(home), String(pid), { mode: 0o600 });
}

/** Removes the PID file if it is ours. Synchronous, so it works from a process 'exit' handler. */
export function clearPidFileSync(home: string, pid = process.pid): void {
  try {
    if (Number.parseInt(readFileSync(pidFile(home), 'utf8').trim(), 10) === pid) rmSync(pidFile(home));
  } catch {
    /* no file */
  }
}

/** Starts `node <cli> start` detached with no window; output goes to agent.log. Returns its PID. */
export function spawnBackground(home: string, cliPath: string, nodePath = process.execPath): number {
  const log = logFile(home);
  // Keep one previous log; never grow without bound.
  if (existsSync(log) && statSync(log).size > MAX_LOG_BYTES) renameSync(log, `${log}.1`);
  const fd = openSync(log, 'a');
  try {
    const child = spawn(nodePath, [cliPath, 'start'], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, POCKET_AGENT_BACKGROUND: '1' },
    });
    child.unref();
    if (!child.pid) throw new Error('could not start the agent process');
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

/** Stops a running agent. Resolves true if one was running and is now gone. */
export async function stopRunning(home: string, timeoutMs = 5000): Promise<boolean> {
  const pid = await runningPid(home);
  if (!pid) return false;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (isAlive(pid)) throw new Error(`The agent (PID ${pid}) did not stop.`);
  await rm(pidFile(home), { force: true });
  return true;
}

/** True when running from npx's temporary cache, which can disappear (bad for hooks and auto-start). */
export function isEphemeralInstall(cliPath: string): boolean {
  return /[\\/]_npx[\\/]/.test(cliPath);
}
