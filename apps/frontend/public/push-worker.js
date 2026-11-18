/* global self */
/* Push only: no fetch interception, offline cache, private record data or API credentials. */
'use strict';
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', event => {
  let deliveryId = null;
  try {
    const value = event.data?.json()?.deliveryId;
    if (typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) deliveryId = value;
  } catch { /* A received push always produces generic visible feedback. */ }
  event.waitUntil(self.registration.showNotification('Service Ops CRM', {
    body: 'Есть новое уведомление. Откройте CRM, чтобы проверить доступ и посмотреть запись.',
    icon: '/push-app-192.png', badge: '/push-app-192.png',
    tag: `service-ops-push-${deliveryId || 'generic'}`, data: { deliveryId },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.deliveryId;
  const valid = typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const target = new URL(`/settings/notifications${valid ? `?delivery=${encodeURIComponent(id)}` : ''}`, self.location.origin).href;
  // New window preserves any unsaved draft in an existing CRM tab. The page
  // performs authenticated fresh source resolution; no payload-supplied URL.
  event.waitUntil(self.clients.openWindow(target));
});
// Subscription expiry/permission revocation is reconciled on explicit manual
// settings refresh/connect. No silent resubscribe, auto-prompt or auto-test.
