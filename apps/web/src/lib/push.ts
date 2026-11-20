'use client';

import { apiRequest } from '@/lib/api';

/** Firebase web config from the environment. Null when push isn't configured for this deployment. */
export function firebaseConfig() {
  const c = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!c.apiKey || !c.projectId || !c.messagingSenderId || !c.appId || !vapidKey) return null;
  return { app: c as Record<keyof typeof c, string>, vapidKey };
}

export type PushSupport =
  | { kind: 'supported' }
  | { kind: 'not_configured' }
  | { kind: 'insecure' }
  | { kind: 'ios_install_required' }
  | { kind: 'unsupported' };

export function isIos(ua: string): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
}

/** What this browser can do. Pure inputs so it can be unit tested. */
export function detectPushSupport(env: {
  configured: boolean;
  secure: boolean;
  userAgent: string;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}): PushSupport {
  if (!env.configured) return { kind: 'not_configured' };
  if (!env.secure) return { kind: 'insecure' };
  // iOS/iPadOS 16.4+ only delivers web push to a site added to the Home Screen.
  if (isIos(env.userAgent) && !env.standalone) return { kind: 'ios_install_required' };
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return { kind: 'unsupported' };
  return { kind: 'supported' };
}

export function browserPushSupport(): PushSupport {
  return detectPushSupport({
    configured: firebaseConfig() !== null,
    secure: window.isSecureContext,
    userAgent: navigator.userAgent,
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
  });
}

const TOKEN_KEY = 'agentdock.pushToken';

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token is simply re-fetched next time */
  }
}

async function messaging() {
  const cfg = firebaseConfig();
  if (!cfg) throw new Error('Push is not configured for this deployment.');
  const [{ getApps, initializeApp }, m] = await Promise.all([
    import('firebase/app'),
    import('firebase/messaging'),
  ]);
  const app = getApps()[0] ?? initializeApp(cfg.app);
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return { m, messaging: m.getMessaging(app), registration, vapidKey: cfg.vapidKey };
}

/** True if this browser is registered for push with this account (as far as we know locally). */
export function hasLocalRegistration(): boolean {
  return (
    typeof Notification !== 'undefined' && Notification.permission === 'granted' && storedToken() !== null
  );
}

/** Asks for permission (must run from a user gesture) and registers this browser with the API. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser’s site settings.'
        : 'Notification permission was not granted.',
    );
  }
  const { m, messaging: msg, registration, vapidKey } = await messaging();
  const token = await m.getToken(msg, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('This browser did not return a push token.');
  await apiRequest('/push/subscriptions', null, {
    method: 'POST',
    body: { token, platform: 'web', userAgent: navigator.userAgent.slice(0, 300) },
  });
  storeToken(token);
}

/** Unregisters this browser (API first, then the FCM token). */
export async function disablePush(): Promise<void> {
  const token = storedToken();
  if (token) {
    await apiRequest('/push/subscriptions/remove', null, { method: 'POST', body: { token } }).catch(
      () => undefined,
    );
  }
  storeToken(null);
  try {
    const { m, messaging: msg } = await messaging();
    await m.deleteToken(msg);
  } catch {
    /* already gone */
  }
}

/** Re-sends a known token after sign-in, so a browser keeps its push registration across accounts. */
export async function refreshPushRegistration(): Promise<void> {
  if (!hasLocalRegistration() || browserPushSupport().kind !== 'supported') return;
  const { m, messaging: msg, registration, vapidKey } = await messaging();
  const token = await m.getToken(msg, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return;
  await apiRequest('/push/subscriptions', null, {
    method: 'POST',
    body: { token, platform: 'web', userAgent: navigator.userAgent.slice(0, 300) },
  });
  storeToken(token);
}
