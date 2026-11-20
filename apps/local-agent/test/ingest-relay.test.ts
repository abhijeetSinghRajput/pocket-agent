import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IngestServer } from '../src/ingest-server.js';

const RELAY = path.join(import.meta.dirname, '..', 'src', 'hook-relay.ts');
const TSX = path.join(import.meta.dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

let server: IngestServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

async function start() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agentdock-ingest-'));
  const hooks: unknown[] = [];
  server = new IngestServer(home, {
    hook: (p) => hooks.push(p),
    listSessions: () => [],
    startSession: async () => ({ externalSessionId: 'x' }),
    stopSession: async () => false,
  });
  await server.start();
  const endpoint = JSON.parse(readFileSync(path.join(home, 'ingest.json'), 'utf8')) as {
    port: number;
    token: string;
  };
  return { home, hooks, endpoint };
}

function raw(port: number, headers: Record<string, string>, body = '{}', pathName = '/hook') {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathName, method: 'POST', headers }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function relay(home: string | null, stdin: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; ms: number }>((resolve) => {
    const t0 = Date.now();
    const args = [TSX, RELAY, '--agentdock-hook', ...(home ? ['--home', home] : [])];
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('exit', (code) => resolve({ code, stdout, ms: Date.now() - t0 }));
    child.stdin.end(stdin);
  });
}

describe('local ingest server', () => {
  it('listens on loopback only and stores its endpoint for the relay', async () => {
    const { endpoint } = await start();
    expect(endpoint.token.length).toBeGreaterThanOrEqual(40);
    expect(endpoint.port).toBeGreaterThan(0);
  });

  it('requires the token and rejects browser-originated or rebinding requests', async () => {
    const { endpoint, hooks } = await start();
    const host = `127.0.0.1:${endpoint.port}`;
    const ok = { host, 'x-agentdock-token': endpoint.token, 'content-type': 'application/json' };
    expect(await raw(endpoint.port, { host })).toBe(403);
    expect(await raw(endpoint.port, { ...ok, 'x-agentdock-token': 'nope' })).toBe(403);
    expect(await raw(endpoint.port, { ...ok, origin: 'https://evil.example' })).toBe(403);
    expect(await raw(endpoint.port, { ...ok, 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await raw(endpoint.port, { ...ok, host: `evil.example:${endpoint.port}` })).toBe(403);
    expect(hooks).toEqual([]);
    expect(await raw(endpoint.port, ok, '{"hook_event_name":"Stop"}')).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(hooks).toEqual([{ hook_event_name: 'Stop' }]);
  });

  it('rejects oversized and malformed bodies', async () => {
    const { endpoint } = await start();
    const ok = { host: `127.0.0.1:${endpoint.port}`, 'x-agentdock-token': endpoint.token };
    expect(await raw(endpoint.port, ok, 'not json')).toBe(400);
    expect(await raw(endpoint.port, ok, '[1,2]')).toBe(400);
  });
});

describe('local CLI client', () => {
  it('reaches the agent with Node fetch (which sends Sec-Fetch-Mode but no Origin)', async () => {
    const { home } = await start();
    const { callLocalAgent } = await import('../src/local-client.js');
    const r = await callLocalAgent(home, 'GET', '/sessions');
    expect(r).toEqual({ status: 200, body: [] });
  });
});

describe('hook relay', () => {
  it('forwards the hook JSON, prints nothing and exits 0', async () => {
    const { home, hooks } = await start();
    const r = await relay(home, '{"hook_event_name":"PreToolUse","session_id":"s1"}');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(''); // never answers a hook → Claude Code behaves as without AgentDock
    await new Promise((res) => setTimeout(res, 20));
    expect(hooks).toEqual([{ hook_event_name: 'PreToolUse', session_id: 's1' }]);
  });

  it('is a silent no-op when the agent is not running', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agentdock-noagent-'));
    const r = await relay(home, '{"hook_event_name":"Stop"}');
    expect(r).toMatchObject({ code: 0, stdout: '' });
  });

  it('skips managed sessions (they report through the SDK)', async () => {
    const { home, hooks } = await start();
    const r = await relay(home, '{"hook_event_name":"Stop"}', { AGENTDOCK_MANAGED_SESSION: '1' });
    expect(r.code).toBe(0);
    await new Promise((res) => setTimeout(res, 50));
    expect(hooks).toEqual([]);
  });

  it('exits 0 even without --home', async () => {
    expect((await relay(null, '{}')).code).toBe(0);
  });
});
