import { db, getCurrentProfileId, type SyncOperationType, type SyncQueueEntry } from "./dexie";
import {
  executeUpsertReport,
  executeUploadPhoto,
  executeFinalizeReport,
  executeDeleteReport,
} from "./sync-operations";
import { getValidToken } from "../api/token-helper";

// ---------- Progress callback ----------
export interface SyncProgress {
  total: number;
  completed: number;
  currentOp: string;
}

export interface SyncRunResult {
  synced: number;
  failed: number;
}

type ProgressCallback = (info: SyncProgress) => void;

// ---------- Enqueue ----------
export async function enqueueSyncOp(
  operationType: SyncOperationType,
  entityClientId: string,
  metadata?: Record<string, string>,
): Promise<void> {
  // Deduplicate: skip if a pending entry already exists for this op + entity
  const existing = await db.syncQueue
    .where("[operationType+entityClientId+status]")
    .equals([operationType, entityClientId, "pending"])
    .first();

  // Fallback dedup for browsers that don't support compound index queries
  if (!existing) {
    const all = await db.syncQueue
      .where("entityClientId")
      .equals(entityClientId)
      .toArray();
    const dup = all.find(
      (e) => e.operationType === operationType && e.status === "pending",
    );
    if (dup) return;
  } else {
    return;
  }

  const now = new Date();
  const profileId = await getCurrentProfileId();
  await db.syncQueue.add({
    operationType,
    entityClientId,
    idempotencyKey: crypto.randomUUID(),
    status: "pending",
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    metadata,
    scopeProfileId: profileId,
    createdAt: now,
    updatedAt: now,
  });

  if (operationType === "UPSERT_REPORT") {
    await db.reports.update(entityClientId, { syncStatus: "queued" });
  }
}

// ---------- Process queue ----------
const OP_ORDER: SyncOperationType[] = [
  "UPSERT_REPORT",
  "UPLOAD_PHOTO",
  "FINALIZE_REPORT",
  "DELETE_REPORT",
];

const OP_LABELS: Record<SyncOperationType, string> = {
  UPSERT_REPORT: "Отчёт",
  UPLOAD_PHOTO: "Фото",
  FINALIZE_REPORT: "Завершение",
  DELETE_REPORT: "Удаление",
};

function computeNextRetry(retryCount: number): Date {
  const delayMs = Math.min(Math.pow(2, retryCount) * 5_000, 300_000);
  return new Date(Date.now() + delayMs);
}

export async function processQueue(
  token: string,
  apiUrl: string,
  onProgress?: ProgressCallback,
): Promise<SyncRunResult> {
  const now = new Date();
  const profileId = await getCurrentProfileId();

  // Get all actionable entries (scoped to current user)
  const allEntries = (await db.syncQueue
    .where("status")
    .anyOf(["pending", "failed"])
    .toArray())
    .filter((e) => !profileId || e.scopeProfileId === profileId);

  // Filter: pending always, failed only if nextRetryAt has passed
  const entries = allEntries.filter(
    (e) =>
      e.status === "pending" ||
      (e.status === "failed" && (!e.nextRetryAt || e.nextRetryAt <= now)),
  );

  if (entries.length === 0) {
    console.log("[sync:queue] No actionable entries");
    return { synced: 0, failed: 0 };
  }

  // Sort by operation order, then by createdAt
  entries.sort((a, b) => {
    const oa = OP_ORDER.indexOf(a.operationType);
    const ob = OP_ORDER.indexOf(b.operationType);
    if (oa !== ob) return oa - ob;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  console.log("[sync:queue] Processing", entries.length, "entries:", entries.map((e) => `${e.operationType}:${e.entityClientId.slice(0, 8)}(${e.status})`).join(", "));

  const total = entries.length;
  let completed = 0;
  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    onProgress?.({
      total,
      completed,
      currentOp: OP_LABELS[entry.operationType],
    });

    // Mark in-progress
    await db.syncQueue.update(entry.id!, {
      status: "in-progress",
      updatedAt: new Date(),
    });

    try {
      // Get a fresh token before each operation (handles proactive refresh)
      const freshToken = (await getValidToken()) ?? token;

      const executor =
        entry.operationType === "UPSERT_REPORT"
          ? executeUpsertReport
          : entry.operationType === "UPLOAD_PHOTO"
            ? executeUploadPhoto
            : entry.operationType === "DELETE_REPORT"
              ? executeDeleteReport
              : executeFinalizeReport;

      const result = await executor(entry, freshToken, apiUrl);

      console.log(`[sync:queue] ${entry.operationType}:${entry.entityClientId.slice(0, 8)} =>`, result.success ? "OK" : `FAIL(retryable=${result.retryable}): ${result.error}`);

      if (result.success) {
        await db.syncQueue.update(entry.id!, {
          status: "done",
          updatedAt: new Date(),
        });
        synced++;
      } else if (result.retryable) {
        const newRetryCount = entry.retryCount + 1;
        await db.syncQueue.update(entry.id!, {
          status: "failed",
          retryCount: newRetryCount,
          nextRetryAt: computeNextRetry(newRetryCount),
          lastError: result.error ?? null,
          updatedAt: new Date(),
        });
        failed++;
      } else {
        // Non-retryable failure
        await db.syncQueue.update(entry.id!, {
          status: "failed",
          lastError: result.error ?? null,
          updatedAt: new Date(),
        });
        failed++;
      }
    } catch (err) {
      // Network error — retryable
      const newRetryCount = entry.retryCount + 1;
      await db.syncQueue.update(entry.id!, {
        status: "failed",
        retryCount: newRetryCount,
        nextRetryAt: computeNextRetry(newRetryCount),
        lastError: err instanceof Error ? err.message : "Сетевая ошибка",
        updatedAt: new Date(),
      });
      failed++;
    }

    completed++;
  }

  onProgress?.({ total, completed, currentOp: "" });

  // Clean up done entries
  await db.syncQueue.where("status").equals("done").delete();

  // Save last sync time
  await db.syncMeta.put({
    key: "lastSyncTime",
    value: new Date().toISOString(),
  });
  await db.syncMeta.put({
    key: "lastSyncResult",
    value: JSON.stringify({ synced, failed }),
  });

  return { synced, failed };
}

// ---------- Retry ----------
export async function retryFailed(ids?: number[]): Promise<void> {
  const now = new Date();
  if (ids && ids.length > 0) {
    for (const id of ids) {
      await db.syncQueue.update(id, {
        status: "pending",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        idempotencyKey: crypto.randomUUID(),
        updatedAt: now,
      });
    }
  } else {
    await db.syncQueue
      .where("status")
      .equals("failed")
      .modify({
        status: "pending",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        updatedAt: now,
      });
    // Generate new idempotency keys for each
    const pending = await db.syncQueue
      .where("status")
      .equals("pending")
      .toArray();
    for (const entry of pending) {
      if (entry.id) {
        await db.syncQueue.update(entry.id, {
          idempotencyKey: crypto.randomUUID(),
        });
      }
    }
  }
}

export async function retryFailedItem(id: number): Promise<void> {
  await retryFailed([id]);
}

// ---------- Stats ----------
export async function getSyncStats(): Promise<{
  pending: number;
  failed: number;
  inProgress: number;
}> {
  const profileId = await getCurrentProfileId();
  const all = await db.syncQueue.toArray();
  const scoped = profileId ? all.filter((e) => e.scopeProfileId === profileId) : all;
  return {
    pending: scoped.filter((e) => e.status === "pending").length,
    failed: scoped.filter((e) => e.status === "failed").length,
    inProgress: scoped.filter((e) => e.status === "in-progress").length,
  };
}

export async function getFailedItems(): Promise<SyncQueueEntry[]> {
  const profileId = await getCurrentProfileId();
  const failed = await db.syncQueue.where("status").equals("failed").toArray();
  return profileId ? failed.filter((e) => e.scopeProfileId === profileId) : failed;
}

export async function getLastSyncTime(): Promise<Date | null> {
  const meta = await db.syncMeta.get("lastSyncTime");
  return meta ? new Date(meta.value) : null;
}

export { OP_LABELS };
