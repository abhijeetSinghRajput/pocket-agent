import { argon2, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/**
 * Argon2id parameters: OWASP 2024 minimum recommendation (m=19 MiB, t=2, p=1).
 * Encoded PHC-style so parameters can be raised later without breaking old hashes.
 */
const ARGON = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const tag = await argon2Async('argon2id', { message: password, nonce, ...ARGON });
  return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${nonce.toString('base64url')}$${tag.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(encoded);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, 'base64url');
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(m[4]!, 'base64url'),
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to verify against when the user doesn't exist, so login timing doesn't reveal accounts. */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'));

/** 256-bit random token, URL-safe. Used for session cookies and device secrets. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 for high-entropy secrets (session tokens, device secrets, pairing codes).
 * Not for passwords — those use Argon2id.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// ── Pairing codes ────────────────────────────────────────────────────────────
// Crockford base32 without I, L, O, U: easy to read aloud and type on a phone/PC.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// Short enough to type in one go. 32^6 ≈ 1.07e9 combinations; also single use,
// lives 10 minutes, and guessing is rate limited per IP (see /devices/pair).
export const PAIRING_CODE_LENGTH = 6;

/** Returns a code as shown to the user, e.g. "7KQ2M9". */
export function generatePairingCode(): string {
  let raw = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return raw;
}

/**
 * Canonical form used for hashing: upper-case, separators removed, and the Crockford
 * look-alikes mapped (O→0, I/L→1). Returns null for anything that cannot be a code.
 */
export function normalizePairingCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}
