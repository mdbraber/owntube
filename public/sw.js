const STATIC_CACHE = "owntube-static-v9";
const PAGE_CACHE = "owntube-pages-v9";
const IMAGE_CACHE = "owntube-images-v9";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/logo-dark.png?v=9",
  "/logo-light.png?v=9",
  "/favicon-dark.ico?v=9",
  "/favicon-light.ico?v=9",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== STATIC_CACHE &&
                key !== PAGE_CACHE &&
                key !== IMAGE_CACHE,
            )
            .map((oldKey) => caches.delete(oldKey)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;
  if (reqUrl.pathname.startsWith("/api/")) return;

  const isDocument = event.request.mode === "navigate";
  const isNextStaticAsset = reqUrl.pathname.startsWith("/_next/static/");
  const isScriptOrStyle =
    reqUrl.pathname.endsWith(".js") || reqUrl.pathname.endsWith(".css");
  const isImage =
    reqUrl.pathname.endsWith(".png") ||
    reqUrl.pathname.endsWith(".jpg") ||
    reqUrl.pathname.endsWith(".jpeg") ||
    reqUrl.pathname.endsWith(".webp") ||
    reqUrl.pathname.endsWith(".svg");

  if (isScriptOrStyle) {
    // Network-first avoids serving stale CSS/JS after deploy.
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            void caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  if (isNextStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            void caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        });
      }),
    );
    return;
  }

  if (isImage) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((resp) => {
            if (resp.ok) {
              const copy = resp.clone();
              void caches
                .open(IMAGE_CACHE)
                .then((cache) => cache.put(event.request, copy));
            }
            return resp;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      }),
    );
    return;
  }

  if (isDocument) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            void caches
              .open(PAGE_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || caches.match("/")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(
          () => cached || caches.match("/") || Response.error(),
        )
      );
    }),
  );
});
