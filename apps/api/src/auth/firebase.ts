import { OAuth2Client } from 'google-auth-library';

/** A Google account, as proven by a Firebase ID token. */
export interface GoogleIdentity {
  /** Firebase user id (stable for this Google account in the project). */
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Verifies a Firebase ID token from "Sign in with Google"; throws if it isn't one. */
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export class GoogleTokenError extends Error {}

/**
 * Firebase Auth ID token verification without the Admin SDK (no service account needed): RS256
 * signature against Google's published certificates, audience = the Firebase project id, issuer
 * https://securetoken.google.com/<project>, not expired, signed in with Google, verified email.
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
export function firebaseGoogleVerifier(
  projectId: string,
  fetchCerts: () => Promise<{ certs: Record<string, string>; maxAgeMs: number }> = fetchGoogleCerts,
  now: () => number = Date.now,
): GoogleVerifier {
  const client = new OAuth2Client();
  let cache: { certs: Record<string, string>; until: number } | null = null;

  return async (idToken) => {
    if (!cache || cache.until <= now()) {
      const { certs, maxAgeMs } = await fetchCerts();
      cache = { certs, until: now() + maxAgeMs };
    }
    let payload;
    try {
      const ticket = await client.verifySignedJwtWithCertsAsync(idToken, cache.certs, projectId, [
        `https://securetoken.google.com/${projectId}`,
      ]);
      payload = ticket.getPayload();
    } catch (err) {
      throw new GoogleTokenError(`invalid token: ${(err as Error).message}`);
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    const firebase = (p['firebase'] ?? {}) as Record<string, unknown>;
    const sub = typeof p['sub'] === 'string' ? p['sub'] : '';
    const email = typeof p['email'] === 'string' ? p['email'].toLowerCase() : '';
    const authTime = typeof p['auth_time'] === 'number' ? p['auth_time'] * 1000 : Infinity;
    if (!sub || sub.length > 128) throw new GoogleTokenError('no subject');
    // The library allows 5 minutes of clock skew; Firebase says exp must simply be in the future.
    if (typeof p['exp'] !== 'number' || p['exp'] * 1000 <= now()) throw new GoogleTokenError('expired');
    if (authTime > now() + 60_000) throw new GoogleTokenError('auth_time in the future');
    if (firebase['sign_in_provider'] !== 'google.com') throw new GoogleTokenError('not a Google sign-in');
    if (!email || p['email_verified'] !== true) throw new GoogleTokenError('email not verified');
    return {
      uid: sub,
      email,
      name: typeof p['name'] === 'string' && p['name'].trim() ? p['name'].trim().slice(0, 100) : null,
      picture:
        typeof p['picture'] === 'string' && /^https:\/\//.test(p['picture'])
          ? p['picture'].slice(0, 1000)
          : null,
    };
  };
}

async function fetchGoogleCerts(): Promise<{ certs: Record<string, string>; maxAgeMs: number }> {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`certificates: HTTP ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  return { certs, maxAgeMs: Math.min(Number(maxAge ?? 3600), 24 * 3600) * 1000 };
}
