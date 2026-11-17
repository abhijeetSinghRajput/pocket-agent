import { createEvent, deviceAuthHeader, WS_CLOSE } from '@agentdock/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  browser,
  createUserWithSession,
  deleteUser,
  pairDevice,
  startTestApp,
  type TestApp,
} from './helpers.js';

let t: TestApp;
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp({ sweepIntervalMs: 200 });
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
});

async function pairedDevice() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  return { ...u, ...(await pairDevice(t, u.cookie)) };
}

/** Connects and buffers incoming messages so none are missed. */
function connect(headers: Record<string, string>) {
  const ws = new WebSocket(t.wsUrl, { headers });
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    inbox.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<{ code: number }>((resolve) => ws.on('close', (code) => resolve({ code })));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
  const next = async (pred: (m: Record<string, unknown>) => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error('timed out waiting for message');
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 100);
      });
    }
  };
  return { ws, opened, closed, next, inbox };
}

const waitFor = async (check: () => Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
};

const status = async (id: string) => (await t.ctx.prisma.device.findUniqueOrThrow({ where: { id } })).status;

describe('agent gateway authentication', () => {
  it('rejects connections without or with wrong credentials before upgrading', async () => {
    const d = await pairedDevice();
    await expect(connect({}).opened).rejects.toThrow('HTTP 401');
    await expect(
      connect({ authorization: deviceAuthHeader(d.deviceId, 'y'.repeat(43)) }).opened,
    ).rejects.toThrow('HTTP 401');
  });
});

describe('agent link', () => {
  it('goes Online, acknowledges heartbeats, and goes Offline on disconnect', async () => {
    const d = await pairedDevice();
    const c = connect({ authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) });
    await c.opened;
    await waitFor(async () => (await status(d.deviceId)) === 'Online');

    const hello = createEvent(
      'device.connected',
      { agentVersion: '9.9.9', platform: 'windows', hostname: 'test-pc' },
      { deviceId: d.deviceId },
    );
    c.ws.send(JSON.stringify(hello));
    const ack = await c.next((m) => m['eventType'] === 'ack');
    expect((ack['payload'] as { ackEventId: string }).ackEventId).toBe(hello.eventId);
    expect((await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: d.deviceId } })).agentVersion).toBe(
      '9.9.9',
    );

    const hb = createEvent('device.heartbeat', { activeSessions: 0 });
    c.ws.send(JSON.stringify(hb));
    await c.next((m) => (m['payload'] as { ackEventId?: string }).ackEventId === hb.eventId);

    c.ws.close();
    await waitFor(async () => (await status(d.deviceId)) === 'Offline');
  });

  it('closes connections that keep sending invalid frames and ignores spoofed device ids', async () => {
    const d = await pairedDevice();
    const c = connect({ authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) });
    await c.opened;
    // Spoofing another device id is invalid and not acknowledged.
    const spoof = createEvent(
      'device.heartbeat',
      { activeSessions: 0 },
      { deviceId: '00000000-0000-0000-0000-000000000000' },
    );
    c.ws.send(JSON.stringify(spoof));
    for (let i = 0; i < 11; i++)
      c.ws.send(i % 2 ? '{not json' : JSON.stringify({ eventType: 'device.selfdestruct' }));
    expect((await c.closed).code).toBe(WS_CLOSE.POLICY_VIOLATION);
    expect(c.inbox.filter((m) => m['eventType'] === 'ack')).toEqual([]);
  });

  it('a newer connection replaces the older one', async () => {
    const d = await pairedDevice();
    const headers = { authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) };
    const first = connect(headers);
    await first.opened;
    const second = connect(headers);
    await second.opened;
    expect((await first.closed).code).toBe(WS_CLOSE.REPLACED);
    expect(await status(d.deviceId)).toBe('Online'); // the replacement keeps the device online
    second.ws.close();
  });

  it('revocation drops the live connection and blocks reconnecting', async () => {
    const d = await pairedDevice();
    const headers = { authorization: deviceAuthHeader(d.deviceId, d.deviceSecret) };
    const c = connect(headers);
    await c.opened;
    await waitFor(async () => (await status(d.deviceId)) === 'Online');

    await t.app.inject({ method: 'POST', url: `/devices/${d.deviceId}/revoke`, headers: browser(d.cookie) });
    const notice = await c.next((m) => m['eventType'] === 'device.revoke');
    expect(notice).toBeTruthy();
    expect((await c.closed).code).toBe(WS_CLOSE.REVOKED);
    expect(await status(d.deviceId)).toBe('Revoked'); // not overwritten by Offline

    await expect(connect(headers).opened).rejects.toThrow('HTTP 401');
  });

  it('marks devices Offline when heartbeats stop arriving', async () => {
    const d = await pairedDevice();
    await t.ctx.prisma.device.update({
      where: { id: d.deviceId },
      data: { status: 'Online', lastHeartbeatAt: new Date(Date.now() - 60_000) },
    });
    await waitFor(async () => (await status(d.deviceId)) === 'Offline', 3000);
  });
});
