/* Coolerup service worker: offline app shell + incoming-call push alerts. */
const CACHE = "coolerup-shell-v3";
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

// Handles every push kind the app sends: calls, likes, comments, follows,
// reposts, story likes and direct messages. Payload shape:
//   { kind, title, body, url, tag, from? }
// Calls keep their ring-style behaviour (persistent, vibrating, high urgency).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}

  const kind = data.kind || "generic";
  const isCall = kind === "call";
  const from = data.from || "someone";

  const title = data.title || (isCall ? `Incoming call from @${from}` : "Coolerup");
  const body = data.body || (isCall ? "Tap to answer" : "");
  const url =
    data.url || (isCall ? `/messages?user=${encodeURIComponent(from)}` : "/");

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || (isCall ? "loop-call" : kind),
      renotify: isCall,
      requireInteraction: isCall,
      silent: false,
      vibrate: isCall ? [300, 150, 300, 150, 300] : [120, 80, 120],
      icon: "/icon-192-coolerup.png",
      badge: "/icon-192-coolerup.png",
      data: { url, kind },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          await c.focus();
          // Reuse the open tab but send it to the notification's target.
          if ("navigate" in c) {
            try {
              await c.navigate(url);
            } catch {
              // Cross-origin or unsupported: leave the focused tab as-is.
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// If the browser rotates the subscription, ask any open tab to re-register a
// fresh endpoint instead of silently missing pushes. (The worker has no VAPID
// key or auth token of its own, so the page does the actual re-subscribe.)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of list) {
          c.postMessage({ type: "coolerup:resubscribe-push" });
        }
      } catch {
        // No clients to notify; the next app open will re-register.
      }
    })(),
  );
});
