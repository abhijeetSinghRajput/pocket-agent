import * as SecureStore from 'expo-secure-store';

/**
 * The login session token. It lives in the device's secure storage (Android Keystore / iOS
 * Keychain) and in memory while the app runs. Nothing else is stored about the account.
 */
const KEY = 'pocket-agent.session';

let token: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export const getToken = () => token;

/** Reads the saved session at start-up. */
export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(KEY).catch(() => null);
  return token;
}

export async function saveToken(next: string): Promise<void> {
  token = next;
  await SecureStore.setItemAsync(KEY, next).catch(() => undefined);
  listeners.forEach((l) => l(token));
}

/** Forgets the session on this device (the server side is ended by /auth/logout). */
export function signedOut(): void {
  if (token === null) return;
  token = null;
  void SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  listeners.forEach((l) => l(null));
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
