// AgentDock service worker: shows web push notifications and opens the app when one is tapped.
// Push is only a hint. The page always loads the real state (approvals, sessions) from the API.
// No third-party code runs here.

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
  const title = typeof d.title === 'string' && d.title ? d.title : 'AgentDock';
  const link = typeof d.link === 'string' && d.link.startsWith('/') ? d.link : '/notifications';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof d.body === 'string' ? d.body : '',
      tag: typeof d.tag === 'string' ? d.tag : undefined,
      icon: '/pwa-icon/192',
      badge: '/pwa-icon/96',
      requireInteraction: d.priority === 'critical',
      data: { link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        if ('navigate' in same) await same.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
