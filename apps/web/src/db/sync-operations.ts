import { db, type SyncQueueEntry } from "./dexie";
import { handleAuthError } from "../api/token-helper";
import type { SyncBatchRequest, SyncBatchResponse } from "@stroyfoto/shared";
import { cleanReportPhotos } from "./storage-cleanup";

export interface OpResult {
  success: boolean;
  retryable: boolean;
  error?: string;
  serverId?: string;
}

export async function executeUpsertReport(
  entry: SyncQueueEntry,
  token: string,
  apiUrl: string,
): Promise<OpResult> {
  const report = await db.reports.get(entry.entityClientId);
  if (!report) {
    console.error("[sync:upsert] Report not found in Dexie:", entry.entityClientId);
    return { success: false, retryable: false, error: "Отчёт не найден локально" };
  }

  console.log("[sync:upsert] Starting for report:", report.clientId, "projectId:", report.projectId);

  const batchReq: SyncBatchRequest = {
    items: [
      {
        entityType: "report",
        action: report.serverId ? "update" : "create",
        entityClientId: report.clientId,
        payload: {
          clientId: report.clientId,
          projectId: report.projectId,
          dateTime: report.dateTime.toISOString(),
          workTypes: report.workTypes,
          contractor: report.contractor,
          ownForces: report.ownForces,
          description: report.description,
        },
      },
    ],
  };

  const res = await fetch(`${apiUrl}/api/sync/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": entry.idempotencyKey,
    },
    body: JSON.stringify(batchReq),
  });

  console.log("[sync:upsert] Response status:", res.status);

  if (res.status === 401) {
    console.warn("[sync:upsert] 401 — refreshing token");
    const newToken = await handleAuthError();
    if (newToken) {
      const retry = await fetch(`${apiUrl}/api/sync/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
          "X-Idempotency-Key": entry.idempotencyKey,
        },
        body: JSON.stringify(batchReq),
      });
      console.log("[sync:upsert] Retry response status:", retry.status);
      if (!retry.ok) {
        const errBody = await retry.text();
        console.error("[sync:upsert] Retry failed:", retry.status, errBody);
        return { success: false, retryable: retry.status >= 500, error: `HTTP ${retry.status}` };
      }
      const retryData: SyncBatchResponse = await retry.json();
      console.log("[sync:upsert] Retry response data:", JSON.stringify(retryData));
      const retryResult = retryData.results[0];
      if (!retryResult || retryResult.status !== "ok") {
        console.error("[sync:upsert] Retry result not ok:", retryResult);
        return { success: false, retryable: retryResult?.status === "error", error: retryResult?.message ?? "Sync error" };
      }
      await db.reports.update(entry.entityClientId, { serverId: retryResult.serverId, syncStatus: "queued", updatedAt: new Date() });
      console.log("[sync:upsert] Success (retry). serverId:", retryResult.serverId);
      return { success: true, retryable: false, serverId: retryResult.serverId };
    }
    return { success: false, retryable: false, error: "Сессия истекла. Войдите заново." };
  }

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[sync:upsert] HTTP error:", res.status, errBody);
    return {
      success: false,
      retryable: res.status >= 500,
      error: `HTTP ${res.status}: ${errBody}`,
    };
  }

  const data: SyncBatchResponse = await res.json();
  const result = data.results[0];

  console.log("[sync:upsert] Response data:", JSON.stringify(data));

  if (!result || result.status !== "ok") {
    console.error("[sync:upsert] Result not ok:", result);
    // Data format errors (e.g. invalid UUID) are not retryable
    const isDataError = result?.message?.includes("invalid input syntax") || result?.message?.includes("violates foreign key");
    return {
      success: false,
      retryable: !isDataError,
      error: result?.message ?? "Sync error",
    };
  }

  if (!result.serverId) {
    console.error("[sync:upsert] Server returned ok but no serverId! result:", result);
    return {
      success: false,
      retryable: true,
      error: "Сервер не вернул serverId",
    };
  }

  // Report is on server but photos may not be uploaded yet — keep as "queued"
  await db.reports.update(entry.entityClientId, {
    serverId: result.serverId,
    syncStatus: "queued",
    updatedAt: new Date(),
  });

  console.log("[sync:upsert] Success. serverId:", result.serverId);
  return { success: true, retryable: false, serverId: result.serverId };
}

export async function executeUploadPhoto(
  entry: SyncQueueEntry,
  token: string,
  apiUrl: string,
): Promise<OpResult> {
  const photo = await db.photos.get(entry.entityClientId);
  if (!photo) {
    console.error("[sync:photo] Photo not found in Dexie:", entry.entityClientId);
    return { success: false, retryable: false, error: "Фото не найдено локально" };
  }

  const report = await db.reports.get(photo.reportClientId);
  console.log("[sync:photo] Photo:", photo.clientId, "reportClientId:", photo.reportClientId, "report.serverId:", report?.serverId, "report.syncStatus:", report?.syncStatus);

  if (!report?.serverId) {
    console.warn("[sync:photo] Parent report has no serverId. reportClientId:", photo.reportClientId, "syncStatus:", report?.syncStatus);

    // Auto-repair: if report claims to be synced but has no serverId, re-queue it
    if (report && (report.syncStatus === "synced" || report.syncStatus === "local-only" || report.syncStatus === "queued" || report.syncStatus === "error")) {
      console.log("[sync:photo] Auto-repair: re-queuing UPSERT_REPORT for", photo.reportClientId);
      await db.reports.update(photo.reportClientId, { syncStatus: "local-only" });

      // Import dynamically to avoid circular dependency
      const { enqueueSyncOp } = await import("./sync-queue");
      await enqueueSyncOp("UPSERT_REPORT", photo.reportClientId);
    }

    return { success: false, retryable: true, error: "Отчёт ещё не синхронизирован — поставлен в очередь повторно" };
  }

  if (!photo.blob || photo.blob.size === 0) {
    console.error("[sync:photo] Photo blob is empty:", photo.clientId);
    return { success: false, retryable: false, error: "Файл фото пуст" };
  }

  console.log("[sync:photo] Uploading photo:", photo.clientId, "size:", photo.blob.size, "fileName:", photo.fileName);

  const formData = new FormData();
  formData.append("clientId", photo.clientId);
  formData.append("reportClientId", photo.reportClientId);
  formData.append("file", photo.blob, photo.fileName);

  let res = await fetch(`${apiUrl}/api/photos/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": entry.idempotencyKey,
    },
    body: formData,
  });

  // Handle 401 with token refresh
  if (res.status === 401) {
    const newToken = await handleAuthError();
    if (newToken) {
      const retryForm = new FormData();
      retryForm.append("clientId", photo.clientId);
      retryForm.append("reportClientId", photo.reportClientId);
      retryForm.append("file", photo.blob, photo.fileName);
      res = await fetch(`${apiUrl}/api/photos/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${newToken}`,
          "X-Idempotency-Key": entry.idempotencyKey,
        },
        body: retryForm,
      });
    } else {
      await db.photos.update(photo.clientId, { localStatus: "error" });
      return { success: false, retryable: false, error: "Сессия истекла. Войдите заново." };
    }
  }

  console.log("[sync:photo] Upload response status:", res.status);

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[sync:photo] Upload failed:", res.status, errBody);
    await db.photos.update(photo.clientId, { localStatus: "error" });
    return {
      success: false,
      retryable: res.status >= 500,
      error: `HTTP ${res.status}: ${errBody}`,
    };
  }

  const data = await res.json();
  console.log("[sync:photo] Upload success:", photo.clientId, "serverId:", data.id ?? data.serverId);
  await db.photos.update(photo.clientId, {
    serverId: data.id ?? data.serverId,
    syncStatus: "synced",
    localStatus: "synced",
  });

  return { success: true, retryable: false, serverId: data.id ?? data.serverId };
}

export async function executeFinalizeReport(
  entry: SyncQueueEntry,
  token: string,
  apiUrl: string,
): Promise<OpResult> {
  const report = await db.reports.get(entry.entityClientId);
  if (!report?.serverId) {
    return { success: false, retryable: true, error: "Отчёт ещё не синхронизирован" };
  }

  // Check all photos for this report are synced
  const photos = await db.photos.where("reportClientId").equals(entry.entityClientId).toArray();
  const unsyncedPhotos = photos.filter((p) => p.syncStatus !== "synced");
  if (unsyncedPhotos.length > 0) {
    console.log(`[sync:finalize] ${unsyncedPhotos.length} photos not yet synced for report ${entry.entityClientId}`);
    return { success: false, retryable: true, error: `${unsyncedPhotos.length} фото ещё не загружены` };
  }

  const res = await fetch(`${apiUrl}/api/reports/${report.serverId}/finalize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": entry.idempotencyKey,
    },
  });

  if (!res.ok) {
    // If endpoint doesn't exist (404) or returns 409 (already finalized), treat as success
    if (res.status === 404 || res.status === 409) {
      // Fall through to finalization below
    } else {
      return {
        success: false,
        retryable: res.status >= 500,
        error: `HTTP ${res.status}`,
      };
    }
  }

  // Mark report as fully synced
  await db.reports.update(entry.entityClientId, {
    syncStatus: "synced",
    updatedAt: new Date(),
  });

  // Auto-cleanup: remove photo blobs now that everything is on server
  try {
    const freed = await cleanReportPhotos(entry.entityClientId);
    if (freed > 0) {
      console.log(`[sync:finalize] Cleaned ${(freed / 1024).toFixed(0)} KB of photo blobs for report ${entry.entityClientId}`);
    }
  } catch {
    // Cleanup failure is non-critical
  }

  return { success: true, retryable: false };
}

export async function executeDeleteReport(
  entry: SyncQueueEntry,
  token: string,
  apiUrl: string,
): Promise<OpResult> {
  const serverId = entry.metadata?.serverId;
  if (!serverId) {
    console.warn("[sync:delete] No serverId in metadata, treating as success");
    return { success: true, retryable: false };
  }

  console.log("[sync:delete] Deleting report serverId:", serverId);

  const res = await fetch(`${apiUrl}/api/reports/by-client/${entry.entityClientId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": entry.idempotencyKey,
    },
  });

  console.log("[sync:delete] Response status:", res.status);

  if (res.status === 401) {
    const newToken = await handleAuthError();
    if (newToken) {
      const retry = await fetch(`${apiUrl}/api/reports/by-client/${entry.entityClientId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${newToken}`,
          "X-Idempotency-Key": entry.idempotencyKey,
        },
      });
      if (retry.status === 404 || retry.ok) return { success: true, retryable: false };
      return { success: false, retryable: retry.status >= 500, error: `HTTP ${retry.status}` };
    }
    return { success: false, retryable: false, error: "Сессия истекла. Войдите заново." };
  }

  // 404 means already deleted — treat as success
  if (res.status === 404 || res.ok) {
    return { success: true, retryable: false };
  }

  return {
    success: false,
    retryable: res.status >= 500,
    error: `HTTP ${res.status}`,
  };
}
