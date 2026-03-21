export function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            const shouldUpdate = window.confirm(
              "Доступна новая версия приложения. Обновить?",
            );
            if (shouldUpdate) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
              window.location.reload();
            }
          }
        });
      });

      // Try to register Background Sync (fallback-safe)
      try {
        await registration.sync?.register("stroyfoto-sync");
      } catch {
        // Background Sync not supported — other triggers will cover
      }
    } catch (err) {
      console.error("SW registration failed:", err);
    }
  });

  // Listen for sync trigger messages from SW
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_SYNC_TRIGGER") {
      window.dispatchEvent(new CustomEvent("sw-sync-trigger"));
    }
  });
}

registerSW();
