import { createEvent, NotificationPage, NotificationSettingsDto } from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notify } from '../src/notifications/service.js';
import { notifyOfflineDevices } from '../src/notifications/triggers.js';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  fakePush,
  pairDevice,
  sessionStarted,
  startTestApp,
  waitFor,
  wsClient,
  type TestApp,
} from './helpers.js';

let t: TestApp;
const push = fakePush();
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp({ push: push.sender });
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
});

async function user() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  return u;
}

const services = () => ({
  ...t.ctx,
  bus: { publish: async () => undefined, on: () => undefined, close: async () => undefined },
  push: push.sender,
});

const list = async (cookie: string) =>
  NotificationPage.parse(
    (await t.app.inject({ method: 'GET', url: '/notifications', headers: { cookie } })).json(),
  );

const settings = (cookie: string, payload?: Record<string, unknown>) =>
  payload === undefined
    ? t.app.inject({ method: 'GET', url: '/notification-settings', headers: { cookie } })
    : t.app.inject({ method: 'PUT', url: '/notification-settings', headers: browser(cookie), payload });

const register = (cookie: string, token: string) =>
  t.app.inject({
    method: 'POST',
    url: '/push/subscriptions',
    headers: browser(cookie),
    payload: { token, platform: 'web', userAgent: 'vitest' },
  });

const status = (ext: string, s: 'Running' | 'WaitingForInput' | 'Failed') =>
  createEvent('agent.session.updated', { externalSessionId: ext, status: s }, { sessionId: ext });

const sentTo = (token: string) => push.sent.filter((p) => p.token === token);

describe('notifications', () => {
  it('a held permission request notifies once, pushes without the command, and appears in history', async () => {
    const u = await user();
    const token = `tok-${randomUUID()}`;
    expect((await register(u.cookie, token)).statusCode).toBe(204);
    const tab = wsClient(t.wsUrl.replace('/ws/agent', '/ws/client'), browser(u.cookie));
    await tab.opened;

    const d = await pairDevice(t, u.cookie);
    const agent = await connectAgent(t, d);
    const ext = `sess-${randomUUID()}`;
    await agent.send(sessionStarted(ext, { projectName: 'checkout' }));
    const requestId = `toolu_${randomUUID()}`;
    const held = createEvent(
      'agent.permission.requested',
      {
        toolUseId: requestId,
        toolName: 'Bash',
        input: '{"command":"npm publish --token SECRET"}',
        requestId,
        awaitingRemote: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { sessionId: ext },
    );
    await agent.send(held);
    await agent.send(held); // replay: no second notification

    await waitFor(async () => sentTo(token).length > 0);
    await tab.next((m) => m['eventType'] === 'notification.created');
    const page = await list(u.cookie);
    const perm = page.notifications.filter((n) => n.category === 'permission_required');
    expect(perm).toHaveLength(1);
    expect(perm[0]).toMatchObject({
      priority: 'critical',
      link: '/approvals',
      readAt: null,
      push: { sent: 1 },
    });
    expect(page.unread).toBeGreaterThanOrEqual(1);

    const msg = sentTo(token)[0]!.message;
    expect(msg.title).toContain('Bash');
    expect(JSON.stringify(msg)).not.toContain('npm publish');
    expect(JSON.stringify(msg)).not.toContain('SECRET');
    expect(sentTo(token)).toHaveLength(1);

    // Mark read.
    const r = await t.app.inject({
      method: 'POST',
      url: '/notifications/read',
      headers: browser(u.cookie),
      payload: {},
    });
    expect(r.statusCode).toBe(204);
    expect((await list(u.cookie)).unread).toBe(0);
    agent.ws.close();
    tab.ws.close();
  });

  it('respects category preferences, and agent_started is off by default', async () => {
    const u = await user();
    const s = NotificationSettingsDto.parse((await settings(u.cookie)).json());
    expect(s.categories).toMatchObject({ permission_required: true, agent_started: false });
    expect(s.push).toEqual({ available: true, subscriptions: 0 });

    const d = await pairDevice(t, u.cookie);
    const agent = await connectAgent(t, d);
    await agent.send(sessionStarted(`sess-${randomUUID()}`));
    await new Promise((r) => setTimeout(r, 300)); // triggers run after the ack
    expect((await list(u.cookie)).notifications).toHaveLength(0);

    // Turn agent_started on, turn agent_failed off.
    const put = await settings(u.cookie, { categories: { agent_started: true, agent_failed: false } });
    expect(put.statusCode).toBe(200);
    const ext = `sess-${randomUUID()}`;
    await agent.send(sessionStarted(ext, { projectName: 'billing' }));
    await agent.send(status(ext, 'Failed'));

    await waitFor(async () => (await list(u.cookie)).notifications.length > 0);
    await new Promise((r) => setTimeout(r, 300)); // let any (wrong) failure notification land
    const cats = (await list(u.cookie)).notifications.map((n) => n.category);
    expect(cats).toEqual(['agent_started']);
    agent.ws.close();
  });

  it('task_completed only for managed sessions or a PC in Away mode', async () => {
    const u = await user();
    const d = await pairDevice(t, u.cookie);
    const agent = await connectAgent(t, d);
    const turn = async (ext: string) => {
      await agent.send(status(ext, 'Running'));
      await agent.send(status(ext, 'WaitingForInput'));
    };
    const observed = `sess-${randomUUID()}`;
    await agent.send(sessionStarted(observed));
    await turn(observed);
    const managed = `sess-${randomUUID()}`;
    await agent.send(sessionStarted(managed, { mode: 'managed', projectName: 'managed-proj' }));
    await turn(managed);

    await waitFor(async () => (await list(u.cookie)).notifications.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    let done = (await list(u.cookie)).notifications.filter((n) => n.category === 'task_completed');
    expect(done.map((n) => n.title)).toEqual(['Claude finished · managed-proj']);

    await t.ctx.prisma.device.update({ where: { id: d.deviceId }, data: { awayMode: true } });
    await turn(observed);
    await waitFor(async () => {
      done = (await list(u.cookie)).notifications.filter((n) => n.category === 'task_completed');
      return done.length === 2;
    });
    agent.ws.close();
  });

  it('quiet hours hold back non-critical pushes but keep critical ones; history keeps both', async () => {
    const u = await user();
    const token = `tok-${randomUUID()}`;
    await register(u.cookie, token);
    // A window covering the whole day (crossing midnight) → always quiet.
    const now = new Date();
    const hhmm = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const put = await settings(u.cookie, {
      quietHours: {
        start: hhmm(new Date(now.getTime() - 3600_000)),
        end: hhmm(new Date(now.getTime() + 3600_000)),
        timezone: 'UTC',
      },
    });
    expect(put.statusCode).toBe(200);

    const ctx = services();
    const failed = await notify(ctx, {
      userId: u.user.id,
      category: 'agent_failed',
      title: 'f',
      body: 'b',
      link: '/',
      dedupeKey: `x:${randomUUID()}`,
    });
    const perm = await notify(ctx, {
      userId: u.user.id,
      category: 'permission_required',
      title: 'p',
      body: 'b',
      link: '/approvals',
      dedupeKey: `x:${randomUUID()}`,
    });
    expect(failed).toMatchObject({ pushSent: 0, pushSkipped: 'quiet_hours' });
    expect(perm).toMatchObject({ pushSent: 1, pushSkipped: null });
    expect(sentTo(token).map((p) => p.message.title)).toEqual(['p']);

    // Clearing quiet hours.
    const cleared = NotificationSettingsDto.parse((await settings(u.cookie, { quietHours: null })).json());
    expect(cleared.quietHours).toBeNull();
    expect(
      (await settings(u.cookie, { quietHours: { start: '22:00', end: '07:00', timezone: 'Mars/Base' } }))
        .statusCode,
    ).toBe(400);
  });

  it('drops tokens FCM reports unregistered; a token re-registered by another user moves to them', async () => {
    const a = await user();
    const b = await user();
    const dead = `dead-${randomUUID()}`;
    await register(a.cookie, dead);
    const r = await t.app.inject({ method: 'POST', url: '/notifications/test', headers: browser(a.cookie) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ notification: { push: { sent: 0, skipped: 'send_failed' } } });
    expect(await t.ctx.prisma.pushSubscription.count({ where: { token: dead } })).toBe(0);

    const shared = `tok-${randomUUID()}`;
    await register(a.cookie, shared);
    await register(b.cookie, shared);
    expect(await t.ctx.prisma.pushSubscription.findUnique({ where: { token: shared } })).toMatchObject({
      userId: b.user.id,
    });

    // Removing someone else's token does nothing; your own works.
    await t.app.inject({
      method: 'POST',
      url: '/push/subscriptions/remove',
      headers: browser(a.cookie),
      payload: { token: shared },
    });
    expect(await t.ctx.prisma.pushSubscription.count({ where: { token: shared } })).toBe(1);
    await t.app.inject({
      method: 'POST',
      url: '/push/subscriptions/remove',
      headers: browser(b.cookie),
      payload: { token: shared },
    });
    expect(await t.ctx.prisma.pushSubscription.count({ where: { token: shared } })).toBe(0);
  });

  it('without push configured, notifications are still recorded', async () => {
    const u = await user();
    const n = await notify(
      { ...services(), push: { available: false, send: async () => 'error' } },
      {
        userId: u.user.id,
        category: 'test',
        title: 't',
        body: 'b',
        link: '/',
        dedupeKey: `x:${randomUUID()}`,
      },
    );
    expect(n).toMatchObject({ pushSent: 0, pushSkipped: 'push_not_configured' });
  });

  it('notifies once per offline episode, after the grace period', async () => {
    const u = await user();
    const d = await pairDevice(t, u.cookie);
    const ctx = services();
    const setHeartbeat = (ago: number) =>
      t.ctx.prisma.device.update({
        where: { id: d.deviceId },
        data: { status: 'Offline', lastHeartbeatAt: new Date(Date.now() - ago) },
      });
    const offline = async () =>
      (await list(u.cookie)).notifications.filter((n) => n.category === 'device_disconnected').length;

    await setHeartbeat(30_000); // within the grace period
    await notifyOfflineDevices(ctx);
    expect(await offline()).toBe(0);

    await setHeartbeat(5 * 60_000);
    await notifyOfflineDevices(ctx);
    await notifyOfflineDevices(ctx);
    expect(await offline()).toBe(1);

    await setHeartbeat(4 * 60_000); // a new episode
    await notifyOfflineDevices(ctx);
    expect(await offline()).toBe(2);
  });

  it('history and settings are per user and need a trusted origin to change', async () => {
    const a = await user();
    const b = await user();
    await t.app.inject({ method: 'POST', url: '/notifications/test', headers: browser(a.cookie) });
    expect((await list(a.cookie)).notifications).toHaveLength(1);
    expect((await list(b.cookie)).notifications).toHaveLength(0);
    const id = (await list(a.cookie)).notifications[0]!.id;
    await t.app.inject({
      method: 'POST',
      url: '/notifications/read',
      headers: browser(b.cookie),
      payload: { ids: [id] },
    });
    expect((await list(a.cookie)).unread).toBe(1);

    const evil = await t.app.inject({
      method: 'PUT',
      url: '/notification-settings',
      headers: { cookie: a.cookie, origin: 'https://evil.example' },
      payload: { categories: { permission_required: false } },
    });
    expect(evil.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/notifications' })).statusCode).toBe(401);
  });
});
