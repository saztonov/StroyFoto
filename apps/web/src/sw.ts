import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import {
  CacheFirst,
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

// Photos and reference data are NOT cached in SW.
// Photos: zero-cache policy — blobs live only in IndexedDB until sync, then fetched on-demand.
// Reference data: managed by Dexie with full-replace per user scope.

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
