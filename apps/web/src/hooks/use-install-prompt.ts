import { useCallback, useEffect, useState } from "react";

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    const { outcome } = await deferredPrompt.prompt();
    setDeferredPrompt(null);
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    return outcome;
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    promptInstall,
    isInstalled,
  };
}
