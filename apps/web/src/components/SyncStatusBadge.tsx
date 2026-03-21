import type { LocalSyncStatus } from "@stroyfoto/shared";

const STATUS_CONFIG: Record<
  LocalSyncStatus,
  { dot: string; text: string; bg: string }
> = {
  draft: { dot: "bg-gray-400", text: "Черновик", bg: "bg-gray-50 text-gray-600" },
  "local-only": { dot: "bg-yellow-400", text: "Локальный", bg: "bg-yellow-50 text-yellow-700" },
  queued: { dot: "bg-blue-400", text: "В очереди", bg: "bg-blue-50 text-blue-700" },
  syncing: { dot: "bg-blue-400 animate-pulse", text: "Синхр...", bg: "bg-blue-50 text-blue-700" },
  synced: { dot: "bg-green-400", text: "Синхр.", bg: "bg-green-50 text-green-700" },
  error: { dot: "bg-red-400", text: "Ошибка", bg: "bg-red-50 text-red-700" },
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
