#!/usr/bin/env node
// Claude Code → AgentDock hook relay. Claude Code runs this for each hook event (see
// `agentdock hooks install`). It forwards the hook JSON to the local agent on 127.0.0.1.
//
// Rules:
// - Node built-ins only, so it starts fast (it runs on every tool call).
// - Always exits 0 and prints nothing: in M3 it never answers a hook, so Claude Code's own
//   behaviour (including its permission prompt) is unchanged — even if the agent is down.
// - Managed sessions (started by AgentDock) are skipped: they report through the SDK instead.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';

const MAX_BODY = 1024 * 1024;

function done(): never {
  process.exit(0);
}

if (process.env['AGENTDOCK_MANAGED_SESSION']) done();

const homeIdx = process.argv.indexOf('--home');
const home = homeIdx > 0 ? process.argv[homeIdx + 1] : undefined;
if (!home) done();

let endpoint: { port: number; token: string };
try {
  endpoint = JSON.parse(readFileSync(path.join(home, 'ingest.json'), 'utf8')) as {
    port: number;
    token: string;
  };
  if (typeof endpoint.port !== 'number' || typeof endpoint.token !== 'string') done();
} catch {
  done(); // agent not running
}

const chunks: Buffer[] = [];
let size = 0;
process.stdin.on('data', (c: Buffer) => {
  size += c.length;
  if (size > MAX_BODY) done();
  chunks.push(c);
});
process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);
  const req = request(
    {
      host: '127.0.0.1',
      port: endpoint.port,
      path: '/hook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-agentdock-token': endpoint.token,
      },
      timeout: 3000,
    },
    (res) => {
      res.resume();
      res.on('end', done);
    },
  );
  req.on('error', done);
  req.on('timeout', () => {
    req.destroy();
    done();
  });
  req.end(body);
});
process.stdin.on('error', done);
setTimeout(done, 5000).unref();
