const CACHE = "tlv-quest-shell-v1";
const SHELL = [
  "/offline",
  "/resume",
  "/visuals/quest-mark.svg",
  "/visuals/harbor-hero.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  if (
    url.pathname.startsWith("/play/") ||
    url.pathname.startsWith("/organize/") ||
    url.pathname.startsWith("/recap/")
  ) {
    if (request.mode === "navigate") {
      event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    }
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/offline"))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && ["style", "script", "image", "font"].includes(request.destination)) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
