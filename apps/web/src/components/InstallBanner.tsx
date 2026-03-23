import { useState } from "react";
import { useInstallPrompt } from "../hooks/use-install-prompt";

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-700 dark:bg-blue-900/30">
      <p className="text-sm text-blue-800 dark:text-blue-200">
        Установите приложение для быстрого доступа
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={() => promptInstall()}
          className="rounded-lg bg-blue-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Установить
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg px-2 py-1 text-sm text-blue-600 transition hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-800/50"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
