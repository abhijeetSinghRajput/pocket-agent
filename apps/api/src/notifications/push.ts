import type { NotificationPriority } from '@pocket-agent/protocol';
import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'node:fs';

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path the notification opens. */
  link: string;
  /** The stored notification: tapping it on the phone marks it read. */
  notificationId?: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  priority: NotificationPriority;
  /** Two buttons on the notification, for a yes/no request only (Allow/Deny, or a two-option question). */
  actions?: PushAction[];
}

export interface PushAction {
  /** What the button sends: a decision on `approvalId`, with an answer for a question. */
  id: string;
  title: string;
  approvalId: string;
  decision: 'allow' | 'deny';
  answers?: Record<string, string>;
}

export type PushResult = 'ok' | 'invalid_token' | 'error';

/** Sends one push to one browser registration. */
export interface PushSender {
  readonly available: boolean;
  send(token: string, message: PushMessage): Promise<PushResult>;
}

export const NO_PUSH: PushSender = { available: false, send: async () => 'error' };

/**
 * Firebase Cloud Messaging HTTP v1. Messages are data-only: Pocket Agent's own service worker shows
 * them, so no third-party script runs in the service worker. Content is deliberately minimal —
 * push travels through Google's (and on iOS, Apple's) servers — and push is only a hint: the app
 * always loads the real state from the API when opened.
 */
export function createFcmSender(
  serviceAccountFile: string | undefined,
  log: (msg: string) => void,
): PushSender {
  if (!serviceAccountFile) return NO_PUSH;
  let credentials: { project_id?: string; client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(readFileSync(serviceAccountFile, 'utf8')) as typeof credentials;
  } catch (err) {
    log(`push disabled: cannot read FCM_SERVICE_ACCOUNT_FILE (${(err as Error).message})`);
    return NO_PUSH;
  }
  const projectId = credentials.project_id;
  if (!projectId || !credentials.client_email || !credentials.private_key) {
    log('push disabled: FCM_SERVICE_ACCOUNT_FILE is not a service-account key');
    return NO_PUSH;
  }
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  return {
    available: true,
    async send(token, m) {
      const accessToken = await auth.getAccessToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            webpush: {
              headers: {
                Urgency: m.priority === 'critical' || m.priority === 'high' ? 'high' : 'normal',
                // A permission request is pointless after it expires; others can wait a bit longer.
                TTL: m.priority === 'critical' ? '300' : '3600',
              },
              // FCM data values are strings: the actions travel as JSON.
              data: {
                title: m.title,
                body: m.body,
                link: m.link,
                ...(m.notificationId ? { notificationId: m.notificationId } : {}),
                tag: m.tag,
                priority: m.priority,
                ...(m.actions?.length ? { actions: JSON.stringify(m.actions) } : {}),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!res) return 'error';
      if (res.ok) return 'ok';
      const text = await res.text().catch(() => '');
      // The registration is gone (unsubscribed, app data cleared, …): drop the token.
      if (
        res.status === 404 ||
        text.includes('UNREGISTERED') ||
        (res.status === 400 && text.includes('registration token'))
      ) {
        return 'invalid_token';
      }
      log(`push failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      return 'error';
    },
  };
}
