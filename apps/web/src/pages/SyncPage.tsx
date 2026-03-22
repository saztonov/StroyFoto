import { useEffect, useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/dexie";
import { OP_LABELS } from "../db/sync-queue";
import { deleteLocalReport } from "../db/report-utils";
import { useSync } from "../hooks/use-sync";
import { useOnline } from "../hooks/use-online";
import { SyncProgressBar } from "../components/SyncProgressBar";
import {
  estimateCleanableSpace,
  cleanSyncedBlobData,
  countCleanablePhotos,
} from "../db/storage-cleanup";

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "только что";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч. назад`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} дн. назад`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

export function SyncPage() {
  const isOnline = useOnline();
  const {
    syncNow,
    retryFailed,
    retryItem,
    isSyncing,
    progress,
    lastSyncTime,
    lastResult,
    pendingCount,
    failedCount,
    failedItems,
    isPersisted,
  } = useSync();

  // Pending queue items
  const queueItems = useLiveQuery(
    () => db.syncQueue.where("status").anyOf(["pending", "in-progress"]).toArray(),
    [],
  );

  // Unsynced data size (only truly unsynced photos)
  const unsyncedInfo = useLiveQuery(async () => {
    const unsyncedPhotos = await db.photos
      .filter((p) => p.syncStatus !== "synced")
      .toArray();
    let totalBytes = 0;
    let count = 0;
    for (const p of unsyncedPhotos) {
      if (p.blob && p.blob.size > 0) {
        totalBytes += p.blob.size;
        count++;
      }
    }
    return { totalBytes, count };
  }, []);

  // Storage info
  const [storageInfo, setStorageInfo] = useState<{
    usage: number;
    quota: number;
  } | null>(null);

  // Legacy cleanup (fallback if auto-cleanup missed some)
  const [cleanableSpace, setCleanableSpace] = useState(0);
  const [cleanableCount, setCleanableCount] = useState(0);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState("");

  const loadCleanableInfo = useCallback(async () => {
    try {
      const [space, count] = await Promise.all([
        estimateCleanableSpace(),
        countCleanablePhotos(),
      ]);
      setCleanableSpace(space);
      setCleanableCount(count);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    async function loadStorage() {
      if (!navigator.storage) return;
      try {
        const estimate = await navigator.storage.estimate();
        setStorageInfo({
          usage: estimate.usage ?? 0,
          quota: estimate.quota ?? 0,
        });
      } catch {
        // Storage API not available
      }
    }
    loadStorage();
    loadCleanableInfo();
  }, [isSyncing, loadCleanableInfo]);

  const handleCleanup = async () => {
    if (cleanableCount === 0) return;
    setIsCleaning(true);
    setCleanResult("");
    try {
      const freed = await cleanSyncedBlobData();
      setCleanResult(`Освобождено ${formatBytes(freed)}`);
      await loadCleanableInfo();
    } catch {
      setCleanResult("Ошибка очистки");
    } finally {
      setIsCleaning(false);
    }
  };

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    await navigator.storage.persist();
  };

  return (
    <div className="px-4 py-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">Синхронизация</h2>

      {/* ---------- Persist warning ---------- */}
      {isPersisted === false && pendingCount > 0 && (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          <p className="font-medium">Хранилище не закреплено</p>
          <p className="mt-1 text-xs">
            Браузер может удалить локальные данные при нехватке места.
            Закрепите хранилище, чтобы защитить несинхронизированные отчёты.
          </p>
          <button
            onClick={requestPersistence}
            className="mt-2 rounded-lg bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700 transition hover:bg-orange-200"
          >
            Закрепить хранилище
          </button>
        </div>
      )}

      {/* ---------- Online/offline transition message ---------- */}
      {!isOnline && (
        <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          Вы офлайн. Изменения сохраняются локально и будут синхронизированы при
          восстановлении связи.
        </div>
      )}

      {/* ---------- Stats cards ---------- */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Ожидают</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Ошибки</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{failedCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Сеть</p>
          <p
            className={`mt-1 text-lg font-bold ${isOnline ? "text-green-600" : "text-red-600"}`}
          >
            {isOnline ? "Онлайн" : "Офлайн"}
          </p>
        </div>
      </div>

      {/* ---------- Last sync time ---------- */}
      {lastSyncTime && (
        <p className="mb-4 text-sm text-gray-500">
          Последняя синхронизация:{" "}
          <span className="font-medium text-gray-700">
            {formatRelativeTime(lastSyncTime)}
          </span>
        </p>
      )}

      {/* ---------- Sync button + progress ---------- */}
      <button
        onClick={() => syncNow()}
        disabled={!isOnline || isSyncing || (pendingCount === 0 && failedCount === 0)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white transition hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSyncing ? (
          <>
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Синхронизация...
          </>
        ) : (
          "Синхронизировать"
        )}
      </button>

      {isSyncing && progress && (
        <div className="mb-6">
          <SyncProgressBar
            total={progress.total}
            completed={progress.completed}
            currentOp={progress.currentOp}
          />
        </div>
      )}

      {/* ---------- Last result ---------- */}
      {lastResult && !isSyncing && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Результат последней синхронизации
          </h3>
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-gray-500">Синхронизировано: </span>
              <span className="font-bold text-green-600">
                {lastResult.synced}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Ошибки: </span>
              <span className="font-bold text-red-600">
                {lastResult.failed}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Failed items ---------- */}
      {failedItems.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Ошибки ({failedItems.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!confirm("Удалить все проблемные отчёты и связанные данные?")) return;
                  const reportIds = new Set<string>();
                  for (const item of failedItems) {
                    if (item.operationType === "UPSERT_REPORT") {
                      reportIds.add(item.entityClientId);
                    } else if (item.operationType === "UPLOAD_PHOTO") {
                      const photo = await db.photos.get(item.entityClientId);
                      if (photo) reportIds.add(photo.reportClientId);
                    }
                  }
                  for (const id of reportIds) {
                    await deleteLocalReport(id);
                  }
                }}
                className="rounded-lg bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 transition hover:bg-gray-200"
              >
                Удалить все
              </button>
              <button
                onClick={() => retryFailed()}
                disabled={!isOnline || isSyncing}
                className="rounded-lg bg-red-50 px-3 py-1 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
              >
                Повторить все
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {failedItems.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-red-200 bg-white px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                          item.operationType === "UPSERT_REPORT"
                            ? "bg-blue-400"
                            : item.operationType === "UPLOAD_PHOTO"
                              ? "bg-purple-400"
                              : "bg-green-400"
                        }`}
                      />
                      <span className="font-medium">
                        {OP_LABELS[item.operationType]}
                      </span>
                      {item.retryCount > 0 && (
                        <span className="text-xs text-gray-400">
                          (попытка {item.retryCount})
                        </span>
                      )}
                    </div>
                    {item.lastError && (
                      <p className="mt-1 truncate text-xs text-red-500">
                        {item.lastError}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-gray-400 font-mono truncate">
                      {item.entityClientId}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={async () => {
                        if (!confirm("Удалить этот отчёт и все связанные данные?")) return;
                        let reportId = item.entityClientId;
                        if (item.operationType === "UPLOAD_PHOTO") {
                          const photo = await db.photos.get(item.entityClientId);
                          if (photo) reportId = photo.reportClientId;
                        }
                        await deleteLocalReport(reportId);
                      }}
                      className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
                    >
                      Удалить
                    </button>
                    <button
                      onClick={() => retryItem(item.id!)}
                      disabled={!isOnline || isSyncing}
                      className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      Повторить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Pending queue ---------- */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Очередь ({queueItems?.length ?? 0})
        </h3>

        {queueItems && queueItems.length > 0 ? (
          <div className="space-y-2">
            {queueItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      item.operationType === "UPSERT_REPORT"
                        ? "bg-blue-400"
                        : item.operationType === "UPLOAD_PHOTO"
                          ? "bg-purple-400"
                          : "bg-green-400"
                    }`}
                  />
                  <span className="font-medium">
                    {OP_LABELS[item.operationType]}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      item.status === "in-progress"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {item.status === "in-progress" ? "выполняется" : "ожидает"}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Intl.DateTimeFormat("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">
            Очередь пуста
          </p>
        )}
      </div>

      {/* ---------- Storage ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Хранилище</h3>
        {storageInfo ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Использовано</span>
              <span className="font-medium">
                {formatBytes(storageInfo.usage)} /{" "}
                {formatBytes(storageInfo.quota)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{
                  width: `${Math.min(100, (storageInfo.usage / storageInfo.quota) * 100).toFixed(1)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">
                Постоянное хранение:{" "}
                <span
                  className={`font-medium ${isPersisted ? "text-green-600" : "text-yellow-600"}`}
                >
                  {isPersisted ? "Закреплено" : "Не закреплено"}
                </span>
              </span>
              {!isPersisted && (
                <button
                  onClick={requestPersistence}
                  className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-100"
                >
                  Запросить
                </button>
              )}
            </div>

            {/* Unsynced data info */}
            {unsyncedInfo && unsyncedInfo.count > 0 && (
              <div className="mt-1 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
                Несинхронизировано: {formatBytes(unsyncedInfo.totalBytes)} ({unsyncedInfo.count} фото)
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Информация недоступна</p>
        )}
      </div>

      {/* ---------- Auto-cleanup status + fallback manual cleanup ---------- */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          Очистка фото
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          Фото автоматически удаляются из локального хранилища после успешной
          синхронизации. При просмотре отчёта фото загружаются с сервера.
        </p>
        {cleanableCount > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Не очищено автоматически:{" "}
              <span className="font-medium">{formatBytes(cleanableSpace)}</span>{" "}
              ({cleanableCount} фото)
            </p>
            <button
              onClick={handleCleanup}
              disabled={isCleaning}
              className="w-full rounded-xl bg-orange-50 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 active:bg-orange-200 disabled:opacity-50"
            >
              {isCleaning ? "Очистка..." : "Очистить вручную"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Локальные копии фото очищены</p>
        )}
        {cleanResult && (
          <p className="mt-2 text-xs font-medium text-green-600">
            {cleanResult}
          </p>
        )}
      </div>
    </div>
  );
}
