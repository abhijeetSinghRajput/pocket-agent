// Link behaviour against a minimal in-test WebSocket server (reconnect/close-code handling).
// The real API is exercised end-to-end in apps/web/e2e/pairing.spec.ts.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { AgentLink } from '../src/link.js';

const DEVICE = '0190c1a0-0000-7000-8000-000000000001';
const SECRET = 's'.repeat(43);

interface Fake {
  url: string;
  connections: WebSocket[];
  frames: Array<Record<string, unknown>>;
  /** Next upgrade gets this HTTP status + body instead of a WebSocket. */
  rejectNext: { status: number; body: string } | null;
  authHeaders: string[];
  /** When true the server stops acknowledging heartbeats (simulates a half-open link). */
  silent: boolean;
  close: () => Promise<void>;
}

let fake: Fake | null = null;
let link: AgentLink | null = null;
afterEach(async () => {
  link?.stop();
  await fake?.close();
  fake = null;
  link = null;
});

async function startFake(): Promise<Fake> {
  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer();
  const f: Fake = {
    url: '',
    connections: [],
    frames: [],
    rejectNext: null,
    authHeaders: [],
    silent: false,
    close: () =>
      new Promise((r) => {
        f.connections.forEach((c) => c.terminate());
        wss.close();
        server.close(() => r());
      }),
  };
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    f.authHeaders.push(String(req.headers.authorization));
    if (f.rejectNext) {
      const { status, body } = f.rejectNext;
      f.rejectNext = null;
      socket.end(
        `HTTP/1.1 ${status} X\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      f.connections.push(ws);
      ws.on('message', (d) => {
        const msg = JSON.parse(d.toString());
        f.frames.push(msg);
        // Like the real API: acknowledge every event.
        if (!f.silent) {
          ws.send(
            JSON.stringify({
              v: 1,
              eventId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              eventType: 'ack',
              payload: { ackEventId: msg.eventId },
            }),
          );
        }
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return f;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function makeLink(url: string) {
  return new AgentLink({
    apiUrl: url,
    deviceId: DEVICE,
    secret: SECRET,
    agentVersion: '0.1.0',
    platform: 'windows',
    heartbeatMs: 50,
    backoff: { baseMs: 10, maxMs: 20 },
  });
}

describe('AgentLink', () => {
  it('authenticates, announces itself, then sends heartbeats', async () => {
    fake = await startFake();
    link = makeLink(fake.url);
    link.start();
    await until(() => fake!.frames.filter((f) => f['eventType'] === 'device.heartbeat').length >= 2);
    expect(fake.authHeaders[0]).toBe(`PocketAgent-Device ${DEVICE}:${SECRET}`);
    expect(fake.frames[0]!['eventType']).toBe('device.connected');
    expect(fake.frames[0]!['deviceId']).toBe(DEVICE);
  });

  it('reconnects after the server drops the connection', async () => {
    fake = await startFake();
    link = makeLink(fake.url);
    link.start();
    await until(() => fake!.connections.length === 1);
    fake.connections[0]!.close(1001, 'restart');
    await until(() => fake!.connections.length === 2);
  });

  it('detects a silent (half-open) connection and reconnects', async () => {
    fake = await startFake();
    link = makeLink(fake.url);
    link.start();
    await until(() => fake!.connections.length === 1);
    fake.silent = true; // server stops answering but keeps the TCP connection open
    await until(() => fake!.connections.length === 2, 3000);
  });

  it('stays connected while the server keeps answering', async () => {
    fake = await startFake();
    link = makeLink(fake.url);
    link.start();
    await until(() => fake!.connections.length === 1);
    await new Promise((r) => setTimeout(r, 400)); // 8 heartbeat intervals
    expect(fake.connections).toHaveLength(1);
  });

  it('stops for good when revoked (close 4003) and does not reconnect', async () => {
    fake = await startFake();
    link = makeLink(fake.url);
    const stopped = new Promise((r) => link!.on('stopped', r));
    link.start();
    await until(() => fake!.connections.length === 1);
    fake.connections[0]!.close(4003, 'device revoked');
    expect(await stopped).toBe('revoked');
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.connections).toHaveLength(1);
  });

  it('stops when the upgrade is rejected as revoked (401) instead of retrying forever', async () => {
    fake = await startFake();
    fake.rejectNext = { status: 401, body: '{"error":"device_revoked"}' };
    link = makeLink(fake.url);
    const stopped = new Promise((r) => link!.on('stopped', r));
    link.start();
    expect(await stopped).toBe('revoked');
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.authHeaders).toHaveLength(1);
  });

  it('keeps retrying on server errors (e.g. 502 from a proxy during deploys)', async () => {
    fake = await startFake();
    fake.rejectNext = { status: 502, body: '{}' };
    link = makeLink(fake.url);
    link.start();
    await until(() => fake!.connections.length === 1);
    expect(fake.authHeaders.length).toBeGreaterThanOrEqual(2);
  });
});
