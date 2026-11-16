const CACHE_PREFIX = "traintrace-sites-assets-";
const CACHE_NAME = "traintrace-sites-assets-v1";
const SAME_ORIGIN = self.location.origin;
const IMAGE_PATH = /^\/assets\/.+\.(?:png|webp|svg|ico)$/i;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const APP_ICONS = [
  "/assets/favicon.ico",
  "/assets/traintrace-icon-16.png",
  "/assets/traintrace-icon-32.png",
  "/assets/traintrace-apple-touch-180.png",
  "/assets/traintrace-icon-192.png",
  "/assets/traintrace-icon-512.png",
  "/assets/traintrace-maskable-512.png",
];

function eligibleAsset(url) {
  return (
    url.origin === SAME_ORIGIN &&
    url.search === "" &&
    IMAGE_PATH.test(url.pathname)
  );
}

function cacheableResponse(response, requestedUrl) {
  if (!response || response.status !== 200 || response.redirected) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  if (response.url && response.url !== requestedUrl) return false;

  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return IMAGE_TYPES.has(mime);
}

async function fetchAndCacheAsset(request, cache) {
  const requestedUrl = new URL(request.url);
  if (!eligibleAsset(requestedUrl)) return null;

  const response = await fetch(request);
  if (!cacheableResponse(response, requestedUrl.href)) return response;

  try {
    await cache.put(request, response.clone());
  } catch {
    // Quota or storage errors must not prevent the image from loading.
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_ICONS.map(async (path) => {
      const request = new Request(new URL(path, SAME_ORIGIN).href, {
        credentials: "same-origin",
      });
      try {
        await fetchAndCacheAsset(request, cache);
      } catch {
        // A private or unavailable asset can be fetched after normal navigation.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!eligibleAsset(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetchAndCacheAsset(request, cache);
      return response ?? fetch(request);
    } catch {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;
      return new Response("Static image unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
