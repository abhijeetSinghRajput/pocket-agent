'use client';

/**
 * "Sign in with Google" through Firebase Authentication. Firebase only proves the Google account:
 * its ID token is handed to our API (POST /auth/google), which starts the usual Pocket Agent session.
 * Firebase's own session is signed out right away, so it is never a second way in.
 */
export function googleConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
  return { apiKey, projectId, appId, authDomain };
}

async function firebaseAuth() {
  const cfg = googleConfig();
  if (!cfg) throw new Error('Google sign-in is not set up here.');
  const [{ getApp, getApps, initializeApp }, auth] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  // Its own app instance, so push (which needs other config) is unaffected.
  const app = getApps().some((a) => a.name === 'auth') ? getApp('auth') : initializeApp(cfg, 'auth');
  const a = auth.getAuth(app);
  await auth.setPersistence(a, auth.browserSessionPersistence);
  return { auth, a };
}

/** Popup errors that mean "use a full-page redirect instead" (blocked popups, in-app browsers). */
const USE_REDIRECT = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-environment',
  'auth/web-storage-unsupported',
]);
/** The user closed the window: not an error worth showing. */
const CANCELLED = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export class GoogleCancelled extends Error {}

/** Shows Google's account chooser; resolves to a Firebase ID token (or redirects the page). */
export async function signInWithGoogle(): Promise<string> {
  const { auth, a } = await firebaseAuth();
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await auth.signInWithPopup(a, provider);
    const token = await cred.user.getIdToken();
    await auth.signOut(a);
    return token;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (CANCELLED.has(code)) throw new GoogleCancelled();
    if (USE_REDIRECT.has(code)) {
      await auth.signInWithRedirect(a, provider);
      return new Promise<string>(() => undefined); // the page is navigating away
    }
    throw new Error(friendly(code));
  }
}

/** After a redirect sign-in: the ID token, or null if this page load isn't one. */
export async function finishGoogleRedirect(): Promise<string | null> {
  if (!googleConfig()) return null;
  const { auth, a } = await firebaseAuth();
  try {
    const cred = await auth.getRedirectResult(a);
    if (!cred) return null;
    const token = await cred.user.getIdToken();
    await auth.signOut(a);
    return token;
  } catch (err) {
    throw new Error(friendly((err as { code?: string }).code ?? ''));
  }
}

function friendly(code: string): string {
  if (code === 'auth/unauthorized-domain') {
    return 'Google sign-in is not allowed on this address yet (add it to Firebase Auth → Authorized domains).';
  }
  if (code === 'auth/operation-not-allowed')
    return 'Google sign-in is turned off in Firebase for this project.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  return 'Google sign-in failed. Try again.';
}
