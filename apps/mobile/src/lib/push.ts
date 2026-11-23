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

/** Foreground: the system shows nothing; the app handles it (toast / open chat). */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
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
