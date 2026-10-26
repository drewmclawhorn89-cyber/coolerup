/* Coolerup service worker: incoming-call push alerts. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const from = data.from || "someone";
  event.waitUntil(
    self.registration.showNotification(`Incoming call from @${from}`, {
      body: "Tap to answer",
      tag: "loop-call",
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 150, 300, 150, 300],
      icon: "/icon-192-coolerup.png",
      data: { url: `/messages?user=${encodeURIComponent(from)}` },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
