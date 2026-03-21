import { useState } from "react";
import { useInstallPrompt } from "../hooks/use-install-prompt";

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2.5">
      <p className="text-sm text-blue-800">
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
          className="rounded-lg px-2 py-1 text-sm text-blue-600 transition hover:bg-blue-100"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
