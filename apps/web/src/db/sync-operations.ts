import { db, type SyncQueueEntry } from "./dexie";
import { handleAuthError } from "../api/token-manager";
import type { SyncBatchRequest, SyncBatchResponse } from "@stroyfoto/shared";

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
    return { success: false, retryable: false, error: "Отчёт не найден локально" };
  }

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
          mark: report.mark,
          workType: report.workType,
          area: report.area,
          contractor: report.contractor,
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

  if (res.status === 401) {
    const newToken = await handleAuthError();
    if (newToken) {
      // Retry with refreshed token
      const retry = await fetch(`${apiUrl}/api/sync/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
          "X-Idempotency-Key": entry.idempotencyKey,
        },
        body: JSON.stringify(batchReq),
      });
      if (!retry.ok) {
        return { success: false, retryable: retry.status >= 500, error: `HTTP ${retry.status}` };
      }
      const retryData: SyncBatchResponse = await retry.json();
      const retryResult = retryData.results[0];
      if (!retryResult || retryResult.status !== "ok") {
        return { success: false, retryable: retryResult?.status === "error", error: retryResult?.message ?? "Sync error" };
      }
      await db.reports.update(entry.entityClientId, { serverId: retryResult.serverId, syncStatus: "synced", updatedAt: new Date() });
      return { success: true, retryable: false, serverId: retryResult.serverId };
    }
    return { success: false, retryable: false, error: "Сессия истекла. Войдите заново." };
  }

  if (!res.ok) {
    return {
      success: false,
      retryable: res.status >= 500,
      error: `HTTP ${res.status}`,
    };
  }

  const data: SyncBatchResponse = await res.json();
  const result = data.results[0];

  if (!result || result.status !== "ok") {
    return {
      success: false,
      retryable: result?.status === "error",
      error: result?.message ?? "Sync error",
    };
  }

  await db.reports.update(entry.entityClientId, {
    serverId: result.serverId,
    syncStatus: "synced",
    updatedAt: new Date(),
  });

  return { success: true, retryable: false, serverId: result.serverId };
}

export async function executeUploadPhoto(
  entry: SyncQueueEntry,
  token: string,
  apiUrl: string,
): Promise<OpResult> {
  const photo = await db.photos.get(entry.entityClientId);
  if (!photo) {
    return { success: false, retryable: false, error: "Фото не найдено локально" };
  }

  const report = await db.reports.get(photo.reportClientId);
  if (!report?.serverId) {
    // Parent report not synced yet — skip, will be picked up on next run
    return { success: false, retryable: true, error: "Отчёт ещё не синхронизирован" };
  }

  const formData = new FormData();
  formData.append("file", photo.blob, photo.fileName);
  formData.append("clientId", photo.clientId);
  formData.append("reportClientId", photo.reportClientId);

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
      retryForm.append("file", photo.blob, photo.fileName);
      retryForm.append("clientId", photo.clientId);
      retryForm.append("reportClientId", photo.reportClientId);
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

  if (!res.ok) {
    await db.photos.update(photo.clientId, { localStatus: "error" });
    return {
      success: false,
      retryable: res.status >= 500,
      error: `HTTP ${res.status}`,
    };
  }

  const data = await res.json();
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

  const res = await fetch(`${apiUrl}/api/reports/${report.serverId}/finalize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": entry.idempotencyKey,
    },
  });

  if (!res.ok) {
    // If endpoint doesn't exist (404), treat as success — finalization is optional
    if (res.status === 404) {
      return { success: true, retryable: false };
    }
    return {
      success: false,
      retryable: res.status >= 500,
      error: `HTTP ${res.status}`,
    };
  }

  return { success: true, retryable: false };
}
