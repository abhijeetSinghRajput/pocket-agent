# Notifications and push (M6)

AgentDock records every notification in Postgres. That history is the source of truth. Web push is a
**hint** that something happened. It is never what makes an approval valid, and its delivery is not guaranteed.

## What is notified

| Category | Priority | Default | When |
|---|---|---|---|
| `permission_required` | critical | on | The PC holds a permission request for a remote decision (managed session, or Away mode). |
| `agent_failed` | high | on | A session's status becomes `Failed`. |
| `device_disconnected` | high | on | A paired PC has been offline for 2+ minutes. You get one notification per offline episode. |
| `task_completed` | normal | on | A turn finished (`Running`/`WaitingForPermission` → `WaitingForInput`), but only for managed sessions or while the PC is in Away mode. A finished turn in a session you're watching at the PC isn't news. |
| `agent_started` | low | off | A new session appeared. |

- **Deduplication.** Every notification has a unique `dedupeKey` (for example `approval:<id>` or `offline:<deviceId>:<lastHeartbeat>`). An event replayed by the PC never notifies twice.
- **Preferences.** You can switch each category on or off. A category that is off isn't recorded or pushed.
- **Quiet hours.** These are a local time window in the browser's time zone, and the window may cross midnight. During quiet hours only `critical` notifications (permission requests) are pushed. The others are still recorded and show `Not pushed (quiet hours)` in the history.
- **Deep links.** Tapping a push opens the related page: `/approvals`, `/agents/<id>`, `/devices` or `/notifications`.

## Privacy of push content

Push messages pass through Google's servers, and on iOS through Apple's. Their content is deliberately minimal: a title
such as "Permission needed · Bash" and the project and PC names. **Commands, file paths, tool input and output are never
put in a push.** You see those only after opening AgentDock, which loads them from the API over your session.

## How push works

1. In **Settings → Notifications**, choose *Enable push on this device*. The browser asks for permission, AgentDock
   registers its own service worker (`/sw.js`), and Firebase Cloud Messaging returns a token for this browser. The token
   is stored on your account (`POST /push/subscriptions`).
2. The API sends **data-only** messages with the FCM HTTP v1 API, authenticated by a service account
   (`FCM_SERVICE_ACCOUNT_FILE`). AgentDock's own service worker displays them, so no third-party script runs in the
   service worker.
3. A token that FCM reports as unregistered is deleted immediately. Sign-out doesn't remove a token, because the browser
   is still yours. Turning push off on the device does remove it.

## Platform limitations

| Platform | What to expect |
|---|---|
| Desktop Chrome / Edge / Firefox | Works from `https://` or `http://localhost`. When the browser is fully closed, pushes arrive when it next starts, if they are still within their TTL. |
| Android Chrome | Works over HTTPS. Battery saver or Doze can delay non-urgent messages. Permission requests are sent with `Urgency: high`. |
| iPhone / iPad | Needs **iOS/iPadOS 16.4+** and the app must be **added to the Home Screen** (Share → Add to Home Screen) and opened from there. Safari tabs can't receive web push. The Settings page says so on iOS. |
| Any | The user can block notifications, and the OS (Focus modes, Do Not Disturb) may hide them. Push needs a secure context, so a LAN IP over plain `http` won't work. HTTPS comes in M7. |

Messages expire: permission requests after 5 minutes, which is about how long the PC waits, and everything else after
1 hour. **No push is ever required for correctness.** The Approvals page, the pending badge and the history always
reflect the server's state when opened, and approvals still expire and fall back on the PC exactly as in M5.

## Configuration

| Where | Variable | Notes |
|---|---|---|
| API | `FCM_SERVICE_ACCOUNT_FILE` | Path to a Firebase service-account key JSON, **kept outside the repository**. If it is unset, notifications are in-app only and Settings says so. |
| Web | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | The Firebase web app config. It is public client configuration, not a secret, but it is still per deployment. |
| Web | `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | The public key of the Web Push certificate (Firebase Console → Project settings → Cloud Messaging). |
