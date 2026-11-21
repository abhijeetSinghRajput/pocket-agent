import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firebaseGoogleVerifier, GoogleTokenError } from '../src/auth/firebase.js';

const PROJECT = 'pocket-agent-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'k1';
const certs = { [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() };

const b64 = (v: object | Buffer) =>
  (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url');

/** A Firebase-shaped ID token signed with our test key. */
function token(claims: Record<string, unknown> = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'uid-123',
    iat: now,
    exp: now + 3600,
    auth_time: now,
    email: 'Ada@Example.com',
    email_verified: true,
    name: 'Ada Lovelace',
    picture: 'https://lh3.googleusercontent.com/a/x',
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  };
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const data = `${head}.${b64(body)}`;
  const sig = createSign('RSA-SHA256').update(data).sign(key);
  return `${data}.${b64(sig)}`;
}

const verifier = () => firebaseGoogleVerifier(PROJECT, async () => ({ certs, maxAgeMs: 60_000 }));

describe('Firebase "Sign in with Google" tokens', () => {
  it('accepts a valid token and returns the Google identity', async () => {
    await expect(verifier()(token())).resolves.toEqual({
      uid: 'uid-123',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://lh3.googleusercontent.com/a/x',
    });
  });

  it.each([
    ['another project', { aud: 'someone-else' }],
    ['another issuer', { iss: 'https://accounts.google.com' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['not a Google sign-in', { firebase: { sign_in_provider: 'password' } }],
    ['unverified email', { email_verified: false }],
    ['no email', { email: undefined }],
  ])('rejects a token for %s', async (_why, claims) => {
    await expect(verifier()(token(claims))).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it('rejects a token signed with another key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifier()(token({}, other))).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it('ignores a non-https picture', async () => {
    const id = await verifier()(token({ picture: 'javascript:alert(1)' }));
    expect(id.picture).toBeNull();
  });
});
