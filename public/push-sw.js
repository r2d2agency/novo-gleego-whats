// Push notification service worker handler
// This file is imported by the workbox-generated service worker

const NOTIFICATION_SETTINGS_DB = 'gleego-notification-settings';
const NOTIFICATION_SETTINGS_STORE = 'settings';
const NOTIFICATION_SETTINGS_KEY = 'notification-sound-settings';

function openNotificationSettingsDb() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(NOTIFICATION_SETTINGS_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(NOTIFICATION_SETTINGS_STORE)) {
          db.createObjectStore(NOTIFICATION_SETTINGS_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getNotificationSettings() {
  const db = await openNotificationSettingsDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(NOTIFICATION_SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(NOTIFICATION_SETTINGS_STORE).get(NOTIFICATION_SETTINGS_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      try { db.close(); } catch {}
      resolve(null);
    }
  });
}

function asBoolean(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

async function shouldSuppressByLocalMuteSettings(pushPayload) {
  const notificationData = pushPayload?.data || {};
  const conversationId = notificationData.conversation_id || notificationData.conversationId;
  const isGroup = asBoolean(notificationData.is_group || notificationData.isGroup);

  if (!conversationId && !isGroup) return false;

  const settings = await getNotificationSettings();
  if (!settings) return false;

  const mutedConversations = Array.isArray(settings.mutedConversations) ? settings.mutedConversations : [];
  if (conversationId && mutedConversations.includes(conversationId)) return true;

  if (isGroup && settings.muteGroups) {
    const allowedGroups = Array.isArray(settings.allowedGroups) ? settings.allowedGroups : [];
    return !conversationId || !allowedGroups.includes(conversationId);
  }

  return false;
}

self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const data = event.data.json();

    event.waitUntil((async () => {
      // If the app is open AND visible in any window, suppress the OS push
      // notification — the in-app sound/toast will handle it. This avoids
      // the "double beep" (push sound + in-app sound) when the user is
      // already looking at the app.
      // Exception: explicit test pushes (tag === 'push-test') always show.
      const isTest = data.tag === 'push-test';
      if (!isTest) {
        if (await shouldSuppressByLocalMuteSettings(data)) {
          return; // muted locally — skip OS notification, sound and vibration
        }

        const clientsList = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        const hasVisibleClient = clientsList.some(
          (c) => c.visibilityState === 'visible' && c.focused
        );
        if (hasVisibleClient) {
          return; // app is in foreground — skip OS notification
        }
      }

      const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png?v=2',
        badge: data.badge || '/icons/icon-96.png?v=2',
        vibrate: data.vibrate || [200, 100, 200, 100, 200],
        data: {
          ...data.data,
          url: data.url || data.data?.url || '/',
        },
        actions: data.actions || [],
        tag: data.tag || 'default',
        silent: false,
        renotify: true,
        requireInteraction: data.requireInteraction || false,
      };

      await self.registration.showNotification(data.title || 'Glee-go Whats', options);
    })());
  } catch (err) {
    console.error('Push event error:', err);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

self.addEventListener('notificationclose', function(event) {
  // Optional: track notification dismissals
  console.log('Notification closed:', event.notification.tag);
});
