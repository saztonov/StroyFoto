import type { LocalSyncStatus } from "@stroyfoto/shared";

const STATUS_CONFIG: Record<
  LocalSyncStatus,
  { dot: string; text: string; bg: string }
> = {
  draft: { dot: "bg-gray-400", text: "Черновик", bg: "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300" },
  "local-only": { dot: "bg-yellow-400", text: "Локальный", bg: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300" },
  queued: { dot: "bg-blue-400", text: "В очереди", bg: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  syncing: { dot: "bg-blue-400 animate-pulse", text: "Синхр...", bg: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" },
  synced: { dot: "bg-green-400", text: "Синхр.", bg: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300" },
  error: { dot: "bg-red-400", text: "Ошибка", bg: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300" },
};

interface SyncStatusBadgeProps {
  status: LocalSyncStatus;
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.text}
    </span>
  );
}
