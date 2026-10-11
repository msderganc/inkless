/* Offline service worker (validation V9). scripts/postbuild.mjs fills in the build id and the
 * list of every exported file when copying this into out/. */
const BUILD_ID = "__BUILD_ID__";
const PRECACHE = __PRECACHE__;
const CACHE = `b21s-labels-${BUILD_ID}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Keep only the current build (the previous one stays until this one activates).
      await Promise.all(keys.filter((k) => k.startsWith("b21s-labels-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Pages are exported as /path/index.html (trailingSlash); navigations match by path.
      const key = req.mode === "navigate" ? new URL(url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`, url) : req;
      const hit = await cache.match(key, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        const fallback = await cache.match("/");
        return fallback ?? Response.error();
      }
    })(),
  );
});
