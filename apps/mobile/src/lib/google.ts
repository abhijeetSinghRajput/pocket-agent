import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

/**
 * "Continue with Google". The server accepts a Firebase ID token (the same one the web app sends),
 * so the app gets a Google ID token from the phone's own account picker and exchanges it with
 * Firebase Auth for a Firebase ID token. No Firebase SDK needed.
 *
 * The Google Cloud OAuth "web client" of the Firebase project (google-services.json, client_type 3):
 * Google issues the ID token for it, and Firebase accepts tokens issued for it.
 */
const WEB_CLIENT_ID = '149680475362-2lbfebv01uatusujs3597u7fsn2mduvc.apps.googleusercontent.com';
/** The Firebase project's Android API key (google-services.json). */
const FIREBASE_API_KEY = 'AIzaSyBG5zYQwsG2bgiO0cs8ex7RPblVW3RRSAY';

export class GoogleCancelled extends Error {}

export const googleAvailable = Platform.OS === 'android';

let configured = false;

/** Opens the account picker and returns a Firebase ID token for `/auth/google`. */
export async function signInWithGoogle(): Promise<string> {
  if (!configured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    configured = true;
  }
  let googleIdToken: string | null = null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always ask which account (a previous choice is not reused silently).
    await GoogleSignin.signOut().catch(() => undefined);
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new GoogleCancelled();
    googleIdToken = res.data.idToken;
  } catch (err) {
    if (err instanceof GoogleCancelled) throw err;
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)
        throw new GoogleCancelled();
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
        throw new Error('Google Play services are needed to sign in with Google.');
    }
    throw new Error('Google sign-in failed. Try again.', { cause: err });
  }
  if (!googleIdToken) throw new Error('Google sign-in failed. Try again.');
  return firebaseTokenFor(googleIdToken);
}

/** Firebase Auth (Identity Toolkit REST): Google ID token → Firebase ID token. */
async function firebaseTokenFor(googleIdToken: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The Android key is restricted to this app; these say which app is asking.
        'X-Android-Package': Application.applicationId ?? 'com.mrcodium.pocketagent',
        'X-Android-Cert': ANDROID_CERT_SHA1,
      },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
        returnIdpCredential: true,
      }),
    },
  ).catch(() => null);
  if (!res) throw new Error('Cannot reach Google. Check your connection and try again.');
  const body = (await res.json().catch(() => null)) as {
    idToken?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.idToken) {
    throw new Error(`Google sign-in failed (${body?.error?.message ?? `HTTP ${res.status}`}).`);
  }
  return body.idToken;
}

/** SHA-1 of the app's signing certificate (EAS keystore), no colons, upper case. */
const ANDROID_CERT_SHA1 = '0968ECE3FA5A8348E1CCBAF27B0E5EEB5BBEE72F';
