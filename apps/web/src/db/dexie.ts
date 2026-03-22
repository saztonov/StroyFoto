import Dexie, { type EntityTable } from "dexie";
import type { LocalSyncStatus } from "@stroyfoto/shared";

// ---------- Report ----------
export type PhotoLocalStatus = "pending" | "compressed" | "ready" | "synced" | "error";

export interface LocalReport {
  clientId: string;
  serverId?: string;
  projectId: string;
  dateTime: Date;
  workTypes: string[];
  contractor: string;
  ownForces: string;
  description: string;
  userId: string;
  syncStatus: LocalSyncStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalPhoto {
  clientId: string;
  serverId?: string;
  reportClientId: string;
  blob: Blob;
  thumbnail?: Blob;
  mimeType: string;
  fileName: string;
  size?: number;
  hash?: string;
  localStatus?: PhotoLocalStatus;
  syncStatus: "pending" | "synced" | "conflict";
  createdAt: Date;
}

// ---------- Sync ----------
export type SyncOperationType = "UPSERT_REPORT" | "UPLOAD_PHOTO" | "FINALIZE_REPORT" | "DELETE_REPORT";
export type SyncEntryStatus = "pending" | "in-progress" | "failed" | "done";

export interface SyncQueueEntry {
  id?: number;
  operationType: SyncOperationType;
  entityClientId: string;
  idempotencyKey: string;
  status: SyncEntryStatus;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  /** Optional metadata for operations that need extra context (e.g. serverId for DELETE) */
  metadata?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncMeta {
  key: string;
  value: string;
}

// ---------- Auth ----------
export interface AuthSession {
  id: string;
  userId: string;
  email: string;
  role: "ADMIN" | "WORKER";
  fullName: string;
}

// ---------- Reference data ----------
export interface LocalProject {
  id: string;
  name: string;
  code: string;
  updatedAt: Date;
}

export interface LocalWorkType {
  id: string;
  name: string;
  updatedAt: Date;
}

export interface LocalContractor {
  id: string;
  name: string;
  updatedAt: Date;
}

export interface LocalOwnForce {
  id: string;
  name: string;
  updatedAt: Date;
}

// ---------- Sync state & settings ----------
export interface SyncState {
  entityType: string;
  lastSyncedAt: Date;
  lastSyncVersion?: number;
}

export interface AppSetting {
  key: string;
  value: string;
}

// ---------- Database ----------
const db = new Dexie("stroyfoto") as Dexie & {
  reports: EntityTable<LocalReport, "clientId">;
  photos: EntityTable<LocalPhoto, "clientId">;
  syncQueue: EntityTable<SyncQueueEntry, "id">;
  authSession: EntityTable<AuthSession, "id">;
  projects: EntityTable<LocalProject, "id">;
  workTypes: EntityTable<LocalWorkType, "id">;
  contractors: EntityTable<LocalContractor, "id">;
  ownForces: EntityTable<LocalOwnForce, "id">;
  syncState: EntityTable<SyncState, "entityType">;
  appSettings: EntityTable<AppSetting, "key">;
  syncMeta: EntityTable<SyncMeta, "key">;
};

db.version(1).stores({
  reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
  photos: "clientId, serverId, reportClientId, syncStatus",
  syncQueue: "++id, entityType, entityClientId, createdAt",
  authSession: "id",
});

db.version(2)
  .stores({
    reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
    photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
    syncQueue: "++id, entityType, entityClientId, createdAt",
    authSession: "id",
    projects: "id, code, name",
    workTypes: "id, name",
    contractors: "id, name",
    areas: "id, name, projectId",
    syncState: "entityType",
    appSettings: "key",
  })
  .upgrade((tx) => {
    return tx
      .table("reports")
      .toCollection()
      .modify((report) => {
        if (report.syncStatus === "pending") report.syncStatus = "local-only";
        if (report.syncStatus === "conflict") report.syncStatus = "error";
      });
  });

db.version(3)
  .stores({
    reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
    photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
    syncQueue: "++id, operationType, entityClientId, status, nextRetryAt, createdAt",
    authSession: "id",
    projects: "id, code, name",
    workTypes: "id, name",
    contractors: "id, name",
    areas: "id, name, projectId",
    syncState: "entityType",
    appSettings: "key",
    syncMeta: "key",
  })
  .upgrade((tx) => {
    const now = new Date();
    return tx
      .table("syncQueue")
      .toCollection()
      .modify((entry) => {
        // Migrate v2 shape to v3
        const oldType = (entry as Record<string, unknown>).entityType as string;
        const oldAction = (entry as Record<string, unknown>).action as string;
        entry.operationType =
          oldType === "photo" ? "UPLOAD_PHOTO" : "UPSERT_REPORT";
        entry.idempotencyKey = crypto.randomUUID();
        entry.status = "pending";
        entry.retryCount = 0;
        entry.nextRetryAt = null;
        entry.lastError = null;
        entry.updatedAt = entry.createdAt ?? now;
        // Clean up old fields
        delete (entry as Record<string, unknown>).entityType;
        delete (entry as Record<string, unknown>).action;
      });
  });

// v4: add refreshToken field to existing sessions (prompts re-login)
db.version(4)
  .stores({
    reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
    photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
    syncQueue: "++id, operationType, entityClientId, status, nextRetryAt, createdAt",
    authSession: "id",
    projects: "id, code, name",
    workTypes: "id, name",
    contractors: "id, name",
    areas: "id, name, projectId",
    syncState: "entityType",
    appSettings: "key",
    syncMeta: "key",
  })
  .upgrade((tx) => {
    return tx
      .table("authSession")
      .toCollection()
      .modify((session) => {
        if (!session.refreshToken) {
          session.refreshToken = "";
        }
      });
  });

// v5: add compound index for dedup queries in sync-queue
db.version(5).stores({
  reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
  photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
  syncQueue:
    "++id, operationType, entityClientId, status, [operationType+entityClientId+status], nextRetryAt, createdAt",
  authSession: "id",
  projects: "id, code, name",
  workTypes: "id, name",
  contractors: "id, name",
  areas: "id, name, projectId",
  syncState: "entityType",
  appSettings: "key",
  syncMeta: "key",
});

// v6: remove mark/area fields, workType→workTypes[], add ownForces, remove areas table, add ownForces table
db.version(6)
  .stores({
    reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
    photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
    syncQueue:
      "++id, operationType, entityClientId, status, [operationType+entityClientId+status], nextRetryAt, createdAt",
    authSession: "id",
    projects: "id, code, name",
    workTypes: "id, name",
    contractors: "id, name",
    ownForces: "id, name",
    areas: null, // delete areas table
    syncState: "entityType",
    appSettings: "key",
    syncMeta: "key",
  })
  .upgrade((tx) => {
    return tx
      .table("reports")
      .toCollection()
      .modify((r: Record<string, unknown>) => {
        // Convert workType string → workTypes array
        r.workTypes = r.workType ? [r.workType as string] : [];
        delete r.workType;
        // Remove mark and area
        delete r.mark;
        delete r.area;
        // Add ownForces default
        if (!r.ownForces) r.ownForces = "";
      });
  });

// v7: Supabase Auth migration — simplify authSession, clear project cache
db.version(7)
  .stores({
    reports: "clientId, serverId, projectId, userId, syncStatus, dateTime",
    photos: "clientId, serverId, reportClientId, syncStatus, localStatus",
    syncQueue:
      "++id, operationType, entityClientId, status, [operationType+entityClientId+status], nextRetryAt, createdAt",
    authSession: "id",
    projects: "id, code, name",
    workTypes: "id, name",
    contractors: "id, name",
    ownForces: "id, name",
    syncState: "entityType",
    appSettings: "key",
    syncMeta: "key",
  })
  .upgrade(async (tx) => {
    // Clear auth session (users need to re-login with Supabase Auth)
    await tx.table("authSession").clear();
    // Clear projects sync state so filtered projects are re-fetched
    await tx.table("syncState").where("entityType").equals("projects").delete();
    // Clear cached projects
    await tx.table("projects").clear();
  });

export { db };
