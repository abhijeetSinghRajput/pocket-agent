// Pocket Agent service worker: shows web push notifications and opens the app when one is tapped.
// Push is only a hint. The page always loads the real state (approvals, sessions) from the API.
// No third-party code runs here.

/** The API's address, given when the app registered this worker (`/sw.js?api=…`). */
const API = new URL(self.location.href).searchParams.get('api');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  // FCM wraps data-only messages as { data: {...}, from, fcmMessageId }.
  const d = payload && typeof payload.data === 'object' ? payload.data : payload;
  const title = typeof d.title === 'string' && d.title ? d.title : 'Pocket Agent';
  const link = typeof d.link === 'string' && d.link.startsWith('/') ? d.link : '/notifications';
  // A yes/no request carries two buttons (Allow / Deny, or a question's two answers).
  let actions = [];
  try {
    const parsed = typeof d.actions === 'string' ? JSON.parse(d.actions) : [];
    actions = Array.isArray(parsed) ? parsed.slice(0, 2) : [];
  } catch {
    actions = [];
  }
  event.waitUntil(
    appOnScreen().then((open) =>
      // The app in the foreground shows it itself (a toast, or the open chat).
      open
        ? undefined
        : self.registration.showNotification(title, {
            body: typeof d.body === 'string' ? d.body : '',
            tag: typeof d.tag === 'string' ? d.tag : undefined,
            icon: '/icons/icon-192.png',
            requireInteraction: d.priority === 'critical',
            actions: actions.map((a) => ({ action: a.id, title: a.title })),
            data: {
              link,
              actions,
              notificationId: typeof d.notificationId === 'string' ? d.notificationId : null,
            },
          }),
    ),
  );
});

/**
 * True while the app is in the foreground: visible AND focused (a background tab, a minimised or
 * backgrounded app, or a screen that is off doesn't count). Then the page shows its own toast
 * instead, or nothing at all for the chat that is open. Both checks, because a backgrounded app
 * can still report "visible" for a moment; a missed notification is worse than a duplicate.
 */
async function appOnScreen() {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return tabs.some((c) => c.visibilityState === 'visible' && c.focused);
}

/** Sends the decision a button stands for, with the signed-in browser's session. */
async function decide(a) {
  if (!API || !a || typeof a.approvalId !== 'string') return false;
  const res = await fetch(`${API}/approvals/${encodeURIComponent(a.approvalId)}/decision`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: a.decision, ...(a.answers ? { answers: a.answers } : {}) }),
  }).catch(() => null);
  return !!res && res.ok;
}

/** Tapping a notification (or one of its buttons) means it has been seen: mark it read. */
async function markRead(id) {
  if (!API || typeof id !== 'string') return;
  await fetch(`${API}/notifications/read`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  }).catch(() => undefined);
}

async function openApp(link) {
  const url = new URL(link, self.location.origin).href;
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const same = tabs.find((c) => new URL(c.url).origin === self.location.origin);
  if (same) {
    await same.focus();
    if ('navigate' in same) await same.navigate(url).catch(() => undefined);
    return;
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const read = markRead(data.notificationId);
  if (event.action) {
    const chosen = (data.actions || []).find((a) => a.id === event.action);
    // Answered from the notification; if that didn't work, the app opens to answer there.
    event.waitUntil(
      Promise.all([read, decide(chosen).then((ok) => (ok ? undefined : openApp(data.link || '/approvals')))]),
    );
    return;
  }
  event.waitUntil(Promise.all([read, openApp(data.link || '/chat')]));
});
