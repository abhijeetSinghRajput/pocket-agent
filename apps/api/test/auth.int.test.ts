import { MeResponse } from '@pocket-agent/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto.js';
import {
  browser,
  createUserWithSession,
  deleteUser,
  startTestApp,
  uniqueEmail,
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

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = (Array.isArray(raw) ? raw[0] : raw) as string;
  return first.split(';')[0]!;
}

describe('registration', () => {
  it('creates the account, hashes the password and starts a session', async () => {
    const email = uniqueEmail();
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: browser(),
      payload: { name: 'Ada', email: email.toUpperCase(), password: 'a-long-enough-password' },
    });
    expect(res.statusCode).toBe(201);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const user = await t.ctx.prisma.user.findUniqueOrThrow({ where: { email } }); // stored lower-case
    users.push(user.id);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain('a-long-enough-password');

    const me = await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookieFrom(res) } });
    expect(MeResponse.parse(me.json()).user.email).toBe(email);

    const audit = await t.ctx.prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(audit.map((a) => a.action)).toContain('user.registered');
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { user } = await createUserWithSession(t.ctx);
    users.push(user.id);
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: browser(),
      payload: { name: 'Dup', email: user.email.toUpperCase(), password: 'another-long-password' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects weak passwords and invalid emails', async () => {
    for (const payload of [
      { name: 'x', email: uniqueEmail(), password: 'short' },
      { name: 'x', email: 'not-an-email', password: 'long-enough-password' },
    ]) {
      const res = await t.app.inject({ method: 'POST', url: '/auth/register', headers: browser(), payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('refuses requests without a trusted Origin (CSRF)', async () => {
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/auth/register',
        headers,
        payload: { name: 'x', email: uniqueEmail(), password: 'long-enough-password' },
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('login and sessions', () => {
  it('logs in with the right password and returns the same error for wrong password and unknown email', async () => {
    const { user, password } = await createUserWithSession(t.ctx);
    users.push(user.id);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: browser(),
      payload: { email: user.email, password },
    });
    expect(ok.statusCode).toBe(200);

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: browser(),
      payload: { email: user.email, password: 'wrong-password' },
    });
    const unknown = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: browser(),
      payload: { email: uniqueEmail(), password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('logout revokes the session server-side', async () => {
    const { user, cookie } = await createUserWithSession(t.ctx);
    users.push(user.id);
    expect((await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(
      200,
    );
    const out = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: browser(cookie) });
    expect(out.statusCode).toBe(204);
    // Replaying the old cookie no longer works.
    expect((await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(
      401,
    );
  });

  it('rejects expired sessions', async () => {
    const { user, cookie } = await createUserWithSession(t.ctx);
    users.push(user.id);
    await t.ctx.prisma.authSession.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(0) },
    });
    expect((await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(
      401,
    );
  });

  it('rejects garbage cookies', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'pocket_agent_session=nope' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('brute-force protection', () => {
  it('locks an account after 10 failed attempts, even for the correct password', async () => {
    // Per-IP limits are off for this app, so only the per-account lock can trip.
    const t2 = await startTestApp();
    try {
      const { user, password } = await createUserWithSession(t2.ctx);
      users.push(user.id);
      const login = (pw: string) =>
        t2.app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: browser(),
          payload: { email: user.email, password: pw },
        });
      for (let i = 0; i < 10; i++) expect((await login('wrong-password')).statusCode).toBe(401);
      const res = await login(password);
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('too_many_attempts'); // the account lock, not the IP limiter
    } finally {
      await t2.close();
    }
  });

  it('clears the failure counter after a successful login', async () => {
    const { user, password } = await createUserWithSession(t.ctx);
    users.push(user.id);
    const login = (pw: string) =>
      t.app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: browser(),
        payload: { email: user.email, password: pw },
      });
    for (let i = 0; i < 5; i++) await login('wrong-password');
    expect((await login(password)).statusCode).toBe(200);
    expect(await t.ctx.redis.get(`${t.ctx.env.REDIS_KEY_PREFIX}login-fail:${sha256(user.email)}`)).toBeNull();
  });

  it('rate-limits pairing attempts per IP (code guessing)', async () => {
    const t4 = await startTestApp({ rateLimits: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await t4.app.inject({
          method: 'POST',
          url: '/devices/pair',
          payload: { code: 'AAAAAA', name: 'x', platform: 'windows', agentVersion: '0' },
        });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await t4.close();
    }
  });

  it('rate-limits login attempts per IP', async () => {
    const t3 = await startTestApp({ rateLimits: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await t3.app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: browser(),
          payload: { email: uniqueEmail(), password: 'whatever-password' },
        });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await t3.close();
    }
  });
});

describe('native app sessions (Android / iOS)', () => {
  const app = { 'x-pocket-agent-client': 'mobile' };

  it('signs up without an Origin, gets a token instead of a cookie, and uses it as a bearer', async () => {
    const email = uniqueEmail();
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: app,
      payload: { name: 'Phone', email, password: 'a-long-enough-password' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    const { token, user } = res.json<{ token: string; user: { id: string } }>();
    users.push(user.id);
    expect(token.length).toBeGreaterThan(20);
    const auth = { ...app, authorization: `Bearer ${token}` };

    const me = await t.app.inject({ method: 'GET', url: '/auth/me', headers: auth });
    expect(MeResponse.parse(me.json()).user.email).toBe(email);

    // State-changing routes work with the token and no Origin…
    const code = await t.app.inject({ method: 'POST', url: '/devices/pairing-codes', headers: auth });
    expect(code.statusCode).toBe(201);
    // …and signing out ends that session for good.
    expect((await t.app.inject({ method: 'POST', url: '/auth/logout', headers: auth })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/auth/me', headers: auth })).statusCode).toBe(401);
  });

  it('a browser session still gets no token; no Origin and no app header is refused', async () => {
    const email = uniqueEmail();
    const web = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: browser(),
      payload: { name: 'Web', email, password: 'a-long-enough-password' },
    });
    expect(web.statusCode).toBe(201);
    users.push(web.json<{ user: { id: string } }>().user.id);
    expect(web.json()).not.toHaveProperty('token');

    const bare = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'a-long-enough-password' },
    });
    expect(bare.statusCode).toBe(403);
    // A page on another site can't pass by adding the app header: its Origin is still checked.
    const forged = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { ...app, origin: 'https://evil.example' },
      payload: { email, password: 'a-long-enough-password' },
    });
    expect(forged.statusCode).toBe(403);
  });
});
