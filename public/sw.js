// NEXUS の service worker（DD-01 M01、DD-09 2.1）。
// `/_next/static/` の中の名前に版の付いたファイルだけを保存する。画面の HTML は
// ネットワークから読み、API の応答は保存しない（新しい版を出したときに古い画面が残らないため）。

const CACHE_NAME = "nexus-static-v1";
const STATIC_PREFIX = "/_next/static/";

function isStaticAsset(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith(STATIC_PREFIX)
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 名前の違う古い保存の場所を消す。
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // `/_next/static/` の外は扱わず、ブラウザがそのままネットワークから読む。
  if (!isStaticAsset(event.request)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
      }),
    ),
  );
});
