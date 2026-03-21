import { z } from "zod";
import { createReportSchema, reportSchema } from "./report";
import { photoSchema } from "./photo";

// --- Legacy batch sync (kept for backward compat) ---

export const syncBatchRequestSchema = z.object({
  items: z.array(
    z.object({
      entityType: z.enum(["report", "photo"]),
      action: z.enum(["create", "update", "delete"]),
      entityClientId: z.string().uuid(),
      payload: z.unknown(),
    })
  ),
});

export const syncBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      entityClientId: z.string().uuid(),
      status: z.enum(["ok", "conflict", "error"]),
      serverId: z.string().uuid().optional(),
      message: z.string().optional(),
    })
  ),
});

export type SyncBatchRequest = z.infer<typeof syncBatchRequestSchema>;
export type SyncBatchResponse = z.infer<typeof syncBatchResponseSchema>;

// --- New sync push (reports + photo metadata, no bytes) ---

export const syncPushPhotoSchema = z.object({
  clientId: z.string().uuid(),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const syncPushReportSchema = createReportSchema.extend({
  photos: z.array(syncPushPhotoSchema).default([]),
});

export const syncPushRequestSchema = z.object({
  reports: z.array(syncPushReportSchema).min(1),
});

export const syncPushResultSchema = z.object({
  clientId: z.string().uuid(),
  status: z.enum(["created", "exists", "error"]),
  serverId: z.string().uuid().optional(),
  message: z.string().optional(),
});

export const syncPushResponseSchema = z.object({
  results: z.array(syncPushResultSchema),
  presignedUrls: z.record(z.string(), z.string()),
});

export type SyncPushPhoto = z.infer<typeof syncPushPhotoSchema>;
export type SyncPushReport = z.infer<typeof syncPushReportSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

// --- Sync pull (cursor-based) ---

export const syncPullResponseSchema = z.object({
  reports: z.array(
    reportSchema.extend({
      photos: z.array(photoSchema),
    })
  ),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
