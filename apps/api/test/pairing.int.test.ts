import { deviceAuthHeader, pairingRequestId, PairingRequestCreated } from '@pocket-agent/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticateDevice } from '../src/auth/device-auth.js';
import { browser, createUserWithSession, deleteUser, startTestApp, type TestApp } from './helpers.js';

let t: TestApp;
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.ctx.prisma.pairingRequest.deleteMany({ where: { name: { startsWith: 'QR ' } } });
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
});

async function newUser() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  return u;
}

/** What the PC does first: ask for a request (no credentials). */
async function request(name = 'QR PC') {
  const res = await t.app.inject({
    method: 'POST',
    url: '/devices/pair/requests',
    payload: { name, platform: 'windows', agentVersion: '2.0.0' },
  });
  expect(res.statusCode).toBe(201);
  return PairingRequestCreated.parse(res.json());
}
const poll = (id: string, pollToken: string) =>
  t.app.inject({ method: 'POST', url: `/devices/pair/requests/${id}/poll`, payload: { pollToken } });
const answer = (cookie: string, id: string, action: 'approve' | 'decline') =>
  t.app.inject({ method: 'POST', url: `/pairing/requests/${id}/${action}`, headers: browser(cookie) });

describe('pairing with a QR code', () => {
  it('the PC waits, you approve, the PC collects working credentials once', async () => {
    const { user, cookie } = await newUser();
    const r = await request();
    expect(r.check).toMatch(/^[0-9A-Z]{4}$/);
    // The QR code's link leads back to the request.
    expect(pairingRequestId(r.link)).toBe(r.requestId);

    expect((await poll(r.requestId, r.pollToken)).statusCode).toBe(202);

    // What the phone shows before you approve: the PC and the same check code.
    const seen = await t.app.inject({
      method: 'GET',
      url: `/pairing/requests/${r.requestId}`,
      headers: browser(cookie),
    });
    expect(seen.json().request).toMatchObject({ name: 'QR PC', check: r.check, status: 'pending' });

    const approved = await answer(cookie, r.requestId, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(approved.json().request.status).toBe('approved');

    const got = await poll(r.requestId, r.pollToken);
    expect(got.statusCode).toBe(201);
    const { deviceId, deviceSecret } = got.json() as { deviceId: string; deviceSecret: string };
    const auth = await authenticateDevice(t.ctx, deviceAuthHeader(deviceId, deviceSecret));
    expect(auth.ok && auth.device.userId).toBe(user.id);

    // Once only.
    expect((await poll(r.requestId, r.pollToken)).statusCode).toBe(410);
    const after = await t.app.inject({
      method: 'GET',
      url: `/pairing/requests/${r.requestId}`,
      headers: browser(cookie),
    });
    expect(after.json().request.status).toBe('paired');
    const log = await t.ctx.prisma.auditLog.findFirst({
      where: { userId: user.id, action: 'device.paired' },
    });
    expect(log?.metadata).toMatchObject({ via: 'qr' });
  });

  it('only the PC holding the poll token gets credentials', async () => {
    const { cookie } = await newUser();
    const r = await request();
    await answer(cookie, r.requestId, 'approve');
    expect((await poll(r.requestId, 'not-the-token')).statusCode).toBe(404);
    expect((await poll(r.requestId, r.pollToken)).statusCode).toBe(201);
  });

  it('declined on the phone: the PC is told, and no device is created', async () => {
    const { user, cookie } = await newUser();
    const r = await request();
    expect((await answer(cookie, r.requestId, 'decline')).statusCode).toBe(200);
    const res = await poll(r.requestId, r.pollToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('pairing_declined');
    expect(await t.ctx.prisma.device.count({ where: { userId: user.id } })).toBe(0);
    // Already answered.
    expect((await answer(cookie, r.requestId, 'approve')).statusCode).toBe(409);
  });

  it('someone else cannot see or answer a request you approved; expired ones cannot be approved', async () => {
    const a = await newUser();
    const b = await newUser();
    const r = await request();
    await answer(a.cookie, r.requestId, 'approve');
    const peek = await t.app.inject({
      method: 'GET',
      url: `/pairing/requests/${r.requestId}`,
      headers: browser(b.cookie),
    });
    expect(peek.statusCode).toBe(404);

    const old = await request();
    await t.ctx.prisma.pairingRequest.update({
      where: { id: old.requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const late = await answer(a.cookie, old.requestId, 'approve');
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('pairing_expired');
    expect((await poll(old.requestId, old.pollToken)).statusCode).toBe(410);
  });

  it('approving needs a signed-in browser from a trusted origin', async () => {
    const r = await request();
    const res = await t.app.inject({ method: 'POST', url: `/pairing/requests/${r.requestId}/approve` });
    expect([401, 403]).toContain(res.statusCode);
  });
});
