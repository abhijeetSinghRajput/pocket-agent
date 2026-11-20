import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  ORIGIN,
  pairDevice,
  sessionStarted,
  startTestApp,
  wsClient,
  type TestApp,
} from './helpers.js';

let t: TestApp;
let clientUrl: string;
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp();
  clientUrl = t.wsUrl.replace('/ws/agent', '/ws/client');
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
});

async function newUser() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  return u;
}

describe('/ws/client', () => {
  it('requires a session cookie and an allow-listed Origin', async () => {
    const u = await newUser();
    await expect(wsClient(clientUrl, { origin: ORIGIN }).opened).rejects.toThrow('HTTP 401');
    await expect(wsClient(clientUrl, { cookie: u.cookie }).opened).rejects.toThrow('HTTP 403');
    await expect(
      wsClient(clientUrl, { cookie: u.cookie, origin: 'https://evil.example' }).opened,
    ).rejects.toThrow('HTTP 403');
  });

  it("pushes live updates for the user's own devices and sessions only", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const aliceTab = wsClient(clientUrl, browser(alice.cookie));
    const bobTab = wsClient(clientUrl, browser(bob.cookie));
    await Promise.all([aliceTab.opened, bobTab.opened]);

    const d = await pairDevice(t, alice.cookie);
    const agent = await connectAgent(t, d);
    const online = await aliceTab.next((m) => m['eventType'] === 'device.status.changed');
    expect(online).toMatchObject({ deviceId: d.deviceId, payload: { status: 'Online' } });

    const ext = `sess-${randomUUID()}`;
    await agent.send(sessionStarted(ext));
    const created = await aliceTab.next((m) => m['eventType'] === 'agent.event.created');
    const status = await aliceTab.next((m) => m['eventType'] === 'agent.status.changed');
    expect(created['sessionId']).toBe(status['sessionId']);
    expect((status['payload'] as { status: string }).status).toBe('WaitingForInput');

    agent.ws.close();
    await aliceTab.next(
      (m) =>
        m['eventType'] === 'device.status.changed' &&
        (m['payload'] as { status: string }).status === 'Offline',
    );

    await new Promise((r) => setTimeout(r, 200));
    expect(bobTab.inbox).toEqual([]); // nothing about Alice leaks to Bob
    aliceTab.ws.close();
    bobTab.ws.close();
  });

  it('closes the live socket when that login session signs out', async () => {
    const u = await newUser();
    const tab = wsClient(clientUrl, browser(u.cookie));
    await tab.opened;
    await t.app.inject({ method: 'POST', url: '/auth/logout', headers: browser(u.cookie) });
    expect((await tab.closed).code).toBe(4401);
  });
});
