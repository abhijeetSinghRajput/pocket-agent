import { MeResponse } from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleTokenError, type GoogleIdentity } from '../src/auth/firebase.js';
import {
  browser,
  createUserWithSession,
  deleteUser,
  startTestApp,
  uniqueEmail,
  type TestApp,
} from './helpers.js';

/** Stands in for Firebase: the token is a JSON identity, or "bad". The verifier itself is unit tested. */
const fakeGoogle = async (idToken: string): Promise<GoogleIdentity> => {
  if (idToken.startsWith('bad')) throw new GoogleTokenError('bad signature');
  return JSON.parse(Buffer.from(idToken, 'base64url').toString()) as GoogleIdentity;
};
const tokenFor = (id: Partial<GoogleIdentity>) =>
  Buffer.from(
    JSON.stringify({ uid: randomUUID(), email: uniqueEmail(), name: 'Grace', picture: null, ...id }),
  ).toString('base64url');

let t: TestApp;
let off: TestApp;
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp({ google: fakeGoogle });
  off = await startTestApp({ google: null });
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
  await off.close();
});

const signIn = (app: TestApp, idToken: string) =>
  app.app.inject({ method: 'POST', url: '/auth/google', headers: browser(), payload: { idToken } });

describe('Sign in with Google', () => {
  it('creates an account on first use, then signs the same Google account into it again', async () => {
    const uid = randomUUID();
    const email = uniqueEmail();
    const first = await signIn(t, tokenFor({ uid, email, picture: 'https://lh3.googleusercontent.com/a/1' }));
    expect(first.statusCode).toBe(201);
    const user = MeResponse.parse(first.json()).user;
    users.push(user.id);
    expect(user).toMatchObject({ email, name: 'Grace', avatarUrl: 'https://lh3.googleusercontent.com/a/1' });
    expect(String(first.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const row = await t.ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toBeNull();

    const again = await signIn(t, tokenFor({ uid, email }));
    expect(again.statusCode).toBe(200);
    expect(MeResponse.parse(again.json()).user.id).toBe(user.id);
  });

  it('links an existing email + password account with the same (Google-verified) email', async () => {
    const { user } = await createUserWithSession(t.ctx);
    users.push(user.id);
    const res = await signIn(t, tokenFor({ email: user.email }));
    expect(res.statusCode).toBe(200);
    expect(MeResponse.parse(res.json()).user.id).toBe(user.id);
    const row = await t.ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.googleUid).not.toBeNull();
    expect(row.passwordHash).not.toBeNull(); // the password still works
    const audit = await t.ctx.prisma.auditLog.findFirst({
      where: { userId: user.id, action: 'user.google_linked' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an invalid token without creating anything', async () => {
    const res = await signIn(t, 'bad-token-xxxxxxxxxxxxxxxxx');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_google_token' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses requests from other sites', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/google',
      headers: { origin: 'https://evil.example' },
      payload: { idToken: tokenFor({}) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is off when Firebase is not configured', async () => {
    const res = await signIn(off, tokenFor({}));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'google_login_disabled' });
  });
});
