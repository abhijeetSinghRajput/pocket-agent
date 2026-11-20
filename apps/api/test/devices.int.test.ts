import { DeviceListResponse, deviceAuthHeader, PairingCodeResponse } from '@pocket-agent/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto.js';
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
  t = await startTestApp();
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

const pair = (code: string, name = 'PC') =>
  t.app.inject({
    method: 'POST',
    url: '/devices/pair',
    payload: { code, name, platform: 'windows', agentVersion: '0.1.0' },
  });

const newCode = async (cookie: string) =>
  PairingCodeResponse.parse(
    (await t.app.inject({ method: 'POST', url: '/devices/pairing-codes', headers: browser(cookie) })).json(),
  );

describe('pairing codes', () => {
  it('issues a readable short-lived code and stores only its hash', async () => {
    const { user, cookie } = await newUser();
    const { code, expiresAt } = await newCode(cookie);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const ttl = Date.parse(expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
    const rows = await t.ctx.prisma.pairingCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toContain(code.replace('-', ''));
  });

  it('pairs once; the code cannot be reused', async () => {
    const { cookie } = await newUser();
    const { code } = await newCode(cookie);
    // Typed by a human: lower-case, no dash.
    const first = await pair(code.toLowerCase().replace('-', ''));
    expect(first.statusCode).toBe(201);
    const { deviceId, deviceSecret } = first.json();
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(deviceSecret.length).toBeGreaterThanOrEqual(43);

    const device = await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.secretHash).toBe(sha256(deviceSecret)); // only the hash is stored
    expect(device.remoteApprovalEnabled).toBe(false);

    expect((await pair(code)).statusCode).toBe(400);
  });

  it('rejects expired codes', async () => {
    const { user, cookie } = await newUser();
    const { code } = await newCode(cookie);
    await t.ctx.prisma.pairingCode.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await pair(code)).json().error).toBe('invalid_or_expired_code');
  });

  it('lets exactly one of several concurrent requests use a code', async () => {
    const { cookie } = await newUser();
    const { code } = await newCode(cookie);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => pair(code, `PC ${i}`)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(4);
  });

  it('caps unused codes per user', async () => {
    const { cookie } = await newUser();
    for (let i = 0; i < 5; i++) await newCode(cookie);
    const res = await t.app.inject({
      method: 'POST',
      url: '/devices/pairing-codes',
      headers: browser(cookie),
    });
    expect(res.statusCode).toBe(429);
  });

  it('requires a logged-in user and a trusted origin', async () => {
    const { cookie } = await newUser();
    expect(
      (await t.app.inject({ method: 'POST', url: '/devices/pairing-codes', headers: browser() })).statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ method: 'POST', url: '/devices/pairing-codes', headers: { cookie } })).statusCode,
    ).toBe(403);
  });
});

describe('device ownership', () => {
  it('isolates users: others cannot see or revoke my devices', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const { deviceId } = await pairDevice(t, alice.cookie);

    const aliceList = DeviceListResponse.parse(
      (await t.app.inject({ method: 'GET', url: '/devices', headers: { cookie: alice.cookie } })).json(),
    );
    expect(aliceList.devices.map((d) => d.id)).toEqual([deviceId]);
    expect(JSON.stringify(aliceList)).not.toMatch(/secret/i);

    const bobList = (
      await t.app.inject({ method: 'GET', url: '/devices', headers: { cookie: bob.cookie } })
    ).json();
    expect(bobList.devices).toEqual([]);

    const bobRevoke = await t.app.inject({
      method: 'POST',
      url: `/devices/${deviceId}/revoke`,
      headers: browser(bob.cookie),
    });
    expect(bobRevoke.statusCode).toBe(404);
    expect((await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt).toBeNull();
  });

  it('revokes, records an audit entry, and is idempotent', async () => {
    const { user, cookie } = await newUser();
    const { deviceId } = await pairDevice(t, cookie);
    const r1 = await t.app.inject({
      method: 'POST',
      url: `/devices/${deviceId}/revoke`,
      headers: browser(cookie),
    });
    expect(r1.json().device.status).toBe('Revoked');
    const r2 = await t.app.inject({
      method: 'POST',
      url: `/devices/${deviceId}/revoke`,
      headers: browser(cookie),
    });
    expect(r2.statusCode).toBe(200);
    const actions = (await t.ctx.prisma.auditLog.findMany({ where: { userId: user.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['device.pairing_code_created', 'device.paired', 'device.revoked']),
    );
    expect(actions.filter((a) => a === 'device.revoked')).toHaveLength(1);
  });

  it('returns 404 for malformed device ids', async () => {
    const { cookie } = await newUser();
    const res = await t.app.inject({
      method: 'POST',
      url: '/devices/not-a-uuid/revoke',
      headers: browser(cookie),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('credential rotation', () => {
  const rotate = (deviceId: string, secret: string) =>
    t.app.inject({
      method: 'POST',
      url: '/agent/credentials/rotate',
      headers: { authorization: deviceAuthHeader(deviceId, secret) },
    });

  it('keeps the old secret valid until the new one is used, then retires it', async () => {
    const { cookie } = await newUser();
    const { deviceId, deviceSecret: oldSecret } = await pairDevice(t, cookie);

    const res = await rotate(deviceId, oldSecret);
    expect(res.statusCode).toBe(200);
    const newSecret = res.json().deviceSecret as string;
    expect(newSecret).not.toBe(oldSecret);

    // Lost response? The old secret still works.
    expect((await rotate(deviceId, oldSecret)).statusCode).toBe(200);
    const latest = (await rotate(deviceId, oldSecret)).json().deviceSecret as string;

    // First use of the new secret promotes it...
    expect((await rotate(deviceId, latest)).statusCode).toBe(200);
    // ...and the old one is dead.
    expect((await rotate(deviceId, oldSecret)).statusCode).toBe(401);
  });

  it('confirm completes a rotation without issuing another secret', async () => {
    const { cookie } = await newUser();
    const { deviceId, deviceSecret: oldSecret } = await pairDevice(t, cookie);
    const next = (await rotate(deviceId, oldSecret)).json().deviceSecret as string;
    const confirm = await t.app.inject({
      method: 'POST',
      url: '/agent/credentials/confirm',
      headers: { authorization: deviceAuthHeader(deviceId, next) },
    });
    expect(confirm.statusCode).toBe(204);
    const device = await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.secretHash).toBe(sha256(next));
    expect(device.pendingSecretHash).toBeNull();
    expect((await rotate(deviceId, oldSecret)).statusCode).toBe(401);
  });

  it('rejects wrong secrets and revoked devices', async () => {
    const { cookie } = await newUser();
    const { deviceId, deviceSecret } = await pairDevice(t, cookie);
    expect((await rotate(deviceId, 'x'.repeat(43))).statusCode).toBe(401);
    await t.app.inject({ method: 'POST', url: `/devices/${deviceId}/revoke`, headers: browser(cookie) });
    const res = await rotate(deviceId, deviceSecret);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('device_revoked');
  });
});
