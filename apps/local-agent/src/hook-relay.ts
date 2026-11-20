#!/usr/bin/env node
// Claude Code → Pocket Agent hook relay. Claude Code runs this for each hook event (see
// `pocket-agent hooks install`). It forwards the hook JSON to the local agent on 127.0.0.1.
//
// Rules:
// - Node built-ins only, so it starts fast (it runs on every tool call).
// - Always exits 0. It prints something only when the agent returns hook output — which the agent
//   does only for Stop, to deliver an instruction the PC owner allowed. Permission hooks are never
//   answered, so Claude Code's own permission prompt is unchanged — and if the agent is down,
//   nothing is printed at all.
// - Managed sessions (started by Pocket Agent) are skipped: they report through the SDK instead.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';

const MAX_BODY = 1024 * 1024;

function done(): never {
  process.exit(0);
}

if (process.env['POCKET_AGENT_MANAGED_SESSION']) done();

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
  // A permission request may be held while the user decides on their phone (Away mode); everything
  // else is answered in milliseconds. The agent always answers before this.
  let waitMs = 3000;
  try {
    if (
      (JSON.parse(body.toString('utf8')) as { hook_event_name?: unknown }).hook_event_name ===
      'PermissionRequest'
    ) {
      waitMs = 310_000;
    }
  } catch {
    /* not JSON: forward as is */
  }
  setTimeout(done, waitMs + 2000).unref();
  const req = request(
    {
      host: '127.0.0.1',
      port: endpoint.port,
      path: '/hook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-pocket-agent-token': endpoint.token,
      },
      timeout: waitMs,
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        res.on('end', done);
        return;
      }
      const out: Buffer[] = [];
      res.on('data', (c: Buffer) => out.push(c));
      res.on('end', () => {
        const text = Buffer.concat(out).toString('utf8');
        try {
          const parsed = JSON.parse(text) as unknown;
          // Only a JSON object is valid hook output; anything else is dropped.
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Exit only after the output is flushed (pipe writes may be asynchronous).
            process.stdout.write(text, () => done());
            return;
          }
        } catch {
          /* not JSON: print nothing */
        }
        done();
      });
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
setTimeout(done, 320_000).unref(); // absolute upper bound
