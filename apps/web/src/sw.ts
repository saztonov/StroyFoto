import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare let self: ServiceWorkerGlobalScope;

// ---------- Precache app shell ----------
precacheAndRoute(self.__WB_MANIFEST);

// ---------- Offline navigation fallback ----------
const navigationHandler = createHandlerBoundToURL("/index.html");
registerRoute(new NavigationRoute(navigationHandler));

// ---------- Runtime cache: static assets ----------
registerRoute(
  ({ request }) =>
    ["style", "script", "font"].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: "static-assets" }),
);

// ---------- Runtime cache: images ----------
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ---------- Runtime cache: photos from API ----------
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/photos/"),
  new CacheFirst({
    cacheName: "photos-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ---------- Runtime cache: GET reference/dictionary data ----------
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/reference/"),
  new NetworkFirst({
    cacheName: "reference-data",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ---------- Messages from main thread ----------
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ---------- Background Sync trigger (optional, fallback-safe) ----------
self.addEventListener("sync" as keyof ServiceWorkerGlobalScopeEventMap, ((event: SyncEvent) => {
  if (event.tag === "stroyfoto-sync") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "SW_SYNC_TRIGGER" });
        }
      }),
    );
  }
}) as EventListener);
