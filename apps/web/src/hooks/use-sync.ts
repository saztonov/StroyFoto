import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type SyncQueueEntry } from "../db/dexie";
import {
  processQueue,
  retryFailed,
  retryFailedItem,
  getLastSyncTime,
  type SyncProgress,
  type SyncRunResult,
} from "../db/sync-queue";
import { syncReferenceData } from "../db/reference-data";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "./use-online";
import { getValidToken } from "../api/token-helper";

const MIN_SYNC_INTERVAL_MS = 30_000; // 30 seconds between auto-syncs

export function useSync() {
  const { isAuthenticated } = useAuth();
  const isOnline = useOnline();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const prevOnline = useRef(isOnline);
  const syncLock = useRef(false);
  const lastSyncTs = useRef(0);

  // Reactive queries from Dexie
  const pendingCount =
    useLiveQuery(
      () => db.syncQueue.where("status").anyOf(["pending", "in-progress"]).count(),
      [],
      0,
    );

  const failedCount =
    useLiveQuery(
      () => db.syncQueue.where("status").equals("failed").count(),
      [],
      0,
    );

  const failedItems =
    useLiveQuery(
      () => db.syncQueue.where("status").equals("failed").toArray(),
      [],
      [] as SyncQueueEntry[],
    );

  // Load last sync time on mount
  useEffect(() => {
    getLastSyncTime().then(setLastSyncTime);
  }, []);

  // Core sync function
  const syncNow = useCallback(async () => {
    if (!isAuthenticated || syncLock.current || !isOnline) return;

    const token = await getValidToken();
    if (!token) return;

    syncLock.current = true;
    setIsSyncing(true);
    setProgress(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      // Sync reference data first (non-blocking if fails)
      try {
        await syncReferenceData(token, apiUrl);
      } catch {
        // Reference data sync is non-critical
      }

      const result = await processQueue(token, apiUrl, setProgress);
      setLastResult(result);
      lastSyncTs.current = Date.now();

      const time = await getLastSyncTime();
      setLastSyncTime(time);

      return result;
    } finally {
      syncLock.current = false;
      setIsSyncing(false);
      setProgress(null);
    }
  }, [isAuthenticated, isOnline]);

  const handleRetryFailed = useCallback(
    async (ids?: number[]) => {
      await retryFailed(ids);
      await syncNow();
    },
    [syncNow],
  );

  const handleRetryItem = useCallback(
    async (id: number) => {
      await retryFailedItem(id);
      await syncNow();
    },
    [syncNow],
  );

  // Auto-sync helper (respects interval)
  const autoSync = useCallback(() => {
    if (!isOnline || !isAuthenticated || syncLock.current) return;
    if (Date.now() - lastSyncTs.current < MIN_SYNC_INTERVAL_MS) return;
    syncNow();
  }, [isOnline, isAuthenticated, syncNow]);

  // Trigger 1: App start — sync once on mount
  useEffect(() => {
    if (isAuthenticated && isOnline) {
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Trigger 2: Online event — sync when coming back online
  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      syncNow();
    }
    prevOnline.current = isOnline;
  }, [isOnline, syncNow]);

  // Trigger 3: visibilitychange — sync when tab becomes visible
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        autoSync();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [autoSync]);

  // Trigger 5: SW Background Sync trigger
  useEffect(() => {
    const onSwSync = () => autoSync();
    window.addEventListener("sw-sync-trigger", onSwSync);
    return () => window.removeEventListener("sw-sync-trigger", onSwSync);
  }, [autoSync]);

  return {
    syncNow,
    retryFailed: handleRetryFailed,
    retryItem: handleRetryItem,
    isSyncing,
    progress,
    lastSyncTime,
    lastResult,
    pendingCount,
    failedCount,
    failedItems,
  };
}
