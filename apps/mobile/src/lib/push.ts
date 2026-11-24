import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiRequest } from '@/lib/api';

/**
 * The phone's own notifications. The server sends them through Firebase to this device's token;
 * the app registers that token with the account (`/push/subscriptions`, platform `android`).
 *
 * In the foreground nothing is shown by the system: the app shows a toast itself, or nothing for
 * the chat that is open (the same rule as the web app's service worker).
 */

const TOKEN_KEY = 'pocket-agent.push.token';
/** Set at sign-out when push was on: the next account to sign in gets it back on this phone. */
const RESUME_KEY = 'pocket-agent.push.resume';

export type PushState =
  | { status: 'unsupported'; reason: string }
  | { status: 'off' }
  | { status: 'denied' }
  | { status: 'on'; token: string };

/** Android groups notifications by channel; a permission request must get through, the rest may wait. */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('approvals', {
    name: 'Permission requests',
    description: 'Claude needs your decision, or is asking you a question.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#ee6a1b',
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Activity',
    description: 'Claude finished, a session started, your PC went offline.',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** What a push says, for the app to show it itself while it is open. */
export interface ForegroundPush {
  notificationId: string | null;
  title: string;
  body: string;
  link: string | null;
  /** A permission request or question (the app already shows those in its own sheet). */
  decision: boolean;
}
const foregroundListeners = new Set<(push: ForegroundPush) => void>();

/** Hears each push that arrives while the app is open (the system shows none of them). */
export function onForegroundPush(listener: (push: ForegroundPush) => void): () => void {
  foregroundListeners.add(listener);
  return () => {
    foregroundListeners.delete(listener);
  };
}

/**
 * The app open: the system shows no notification, the app shows a toast instead (none for the
 * chat on screen). Closed or in the background: the system shows it as usual.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : '');
      const push: ForegroundPush = {
        notificationId: str(data['notificationId']) || null,
        title: n.request.content.title ?? str(data['title']),
        body: n.request.content.body ?? (str(data['message']) || str(data['body'])),
        link: str(data['link']) || null,
        decision: data['channelId'] === 'approvals',
      };
      if (push.title) foregroundListeners.forEach((l) => l(push));
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}

export function pushSupported(): { ok: true } | { ok: false; reason: string } {
  if (Platform.OS !== 'android')
    return { ok: false, reason: 'Notifications on iOS come in a later version.' };
  if (!Device.isDevice) return { ok: false, reason: 'Push needs a real phone (not an emulator).' };
  return { ok: true };
}

export async function currentPushState(): Promise<PushState> {
  const support = pushSupported();
  if (!support.ok) return { status: 'unsupported', reason: support.reason };
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'denied') return { status: 'denied' };
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  return token ? { status: 'on', token } : { status: 'off' };
}

/** Asks for permission (if needed), reads this device's token and registers it with the account. */
export async function enablePush(): Promise<PushState> {
  const support = pushSupported();
  if (!support.ok) return { status: 'unsupported', reason: support.reason };
  await ensureChannels();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { status: 'denied' };
  const device = await Notifications.getDevicePushTokenAsync();
  const token = String(device.data);
  await apiRequest('/push/subscriptions', null, {
    method: 'POST',
    body: {
      token,
      platform: 'android',
      userAgent:
        `${Device.manufacturer ?? ''} ${Device.modelName ?? ''} · Android ${Device.osVersion ?? ''} · Pocket Agent ${Application.nativeApplicationVersion ?? ''}`.trim(),
    },
  });
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
  return { status: 'on', token };
}

/**
 * Signing out: this phone stops getting the account's notifications (they name chats and ask for
 * decisions). Must run while the session is still valid. Push comes back at the next sign-in.
 */
export async function pushSignedOut(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await disablePush();
  await AsyncStorage.setItem(RESUME_KEY, '1').catch(() => undefined);
}

/** Stops notifications to this phone (the registration is removed from the account). */
export async function disablePush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (token) {
    await apiRequest('/push/subscriptions/remove', null, { method: 'POST', body: { token } }).catch(
      () => undefined,
    );
  }
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}

/**
 * Keeps the registration current: the token can change (app data cleared, app reinstalled),
 * and a new one must reach the account. Call once per app start while signed in.
 */
export async function refreshPushRegistration(): Promise<void> {
  // Signed out with push on: register this phone with the account that signed in now.
  if (await AsyncStorage.getItem(RESUME_KEY).catch(() => null)) {
    await AsyncStorage.removeItem(RESUME_KEY).catch(() => undefined);
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' }));
    if (status === 'granted') await enablePush().catch(() => undefined);
    return;
  }
  const state = await currentPushState();
  if (state.status !== 'on') return;
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    if (String(device.data) !== state.token) await enablePush();
  } catch {
    /* offline or Firebase not configured: try again next start */
  }
}

/** What a notification carried (the server's data payload). */
export function notificationLink(n: Notifications.Notification): {
  link: string | null;
  notificationId: string | null;
} {
  const data = (n.request.content.data ?? {}) as Record<string, unknown>;
  return {
    link: typeof data['link'] === 'string' ? data['link'] : null,
    notificationId: typeof data['notificationId'] === 'string' ? data['notificationId'] : null,
  };
}
