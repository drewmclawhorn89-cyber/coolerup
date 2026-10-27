/* Coolerup service worker: offline app shell + incoming-call push alerts. */
const CACHE = "coolerup-shell-v2";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon-192-coolerup.png",
  "/icon-512-coolerup.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const isStaticAsset = (url) =>
  /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|gif|svg|ico|avif|mp3)$/i.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never intercept cross-origin requests (Supabase, fonts, Audius). Video
  // bytes are handled by the explicit offline store, not the HTTP cache.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached shell so the app still
  // boots when the connection drops.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => {
          const cached = (await caches.match(req)) || (await caches.match("/"));
          return (
            cached ||
            new Response("You're offline. Open Coolerup again when you have a connection.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  // Static assets: cache-first with a background refresh (stale-while-revalidate).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});

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
