// Regression: on Windows, `process.exit()` while Node's fetch still held a keep-alive connection
// crashed the CLI with a libuv assertion (exit 0xC0000409) instead of a clean error exit.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
const TSX = path.join(import.meta.dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

function run(args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [TSX, CLI, ...args], {
      env: { ...process.env, AGENTDOCK_HOME: mkdtempSync(path.join(os.tmpdir(), 'agentdock-clierr-')) },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

describe('CLI error exits', () => {
  it('reports an API error and exits with code 1 (no crash)', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', connection: 'keep-alive' });
      res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Try again in 9s.' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await run(['pair', 'AAAA-AAAA', '--api', `http://127.0.0.1:${port}`]);
      expect(r.stderr).toContain('Too many requests');
      expect(r.stderr).not.toContain('Assertion failed');
      expect(r.code).toBe(1);
    } finally {
      server.close();
    }
  }, 30_000);

  it('reports an unreachable API cleanly', async () => {
    const r = await run(['pair', 'AAAA-AAAA', '--api', 'http://127.0.0.1:9']);
    expect(r.stderr).toContain('Cannot reach AgentDock');
    expect(r.code).toBe(1);
  }, 30_000);
});
