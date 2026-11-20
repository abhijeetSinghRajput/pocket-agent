// Regression: the agent crashed with EPIPE once its parent process (and stdout pipe) went away.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
const TSX = path.join(import.meta.dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('console loss', () => {
  it('keeps running after its stdout/stderr pipes are closed', async () => {
    // `status --json` writes once; we close the pipe first, so the write hits a dead pipe.
    const child = spawn(process.execPath, [TSX, CLI, 'status', '--json'], {
      env: { ...process.env, POCKET_AGENT_HOME: mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-epipe-')) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.destroy();
    child.stderr.destroy();
    const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    expect(code).toBe(0);
  }, 30_000);
});
