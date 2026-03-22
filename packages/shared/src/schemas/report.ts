import { z } from "zod";

export const WORK_TYPES = [
  "Земляные работы",
  "Фундамент",
  "Кладка",
  "Монолит",
  "Кровля",
  "Фасад",
  "Инженерные сети",
  "Отделка",
  "Благоустройство",
  "Прочее",
] as const;

export const reportSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  projectId: z.string().min(1),
  dateTime: z.coerce.date(),
  workTypes: z.array(z.string().min(1)).min(1),
  contractor: z.string().min(1),
  ownForces: z.string().default(""),
  description: z.string(),
  userId: z.string().uuid(),
  syncStatus: z.enum(["PENDING", "SYNCED", "CONFLICT"]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createReportSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().min(1),
  dateTime: z.coerce.date(),
  workTypes: z.array(z.string().min(1)).min(1),
  contractor: z.string().min(1),
  ownForces: z.string().default(""),
  description: z.string().default(""),
});

export type Report = z.infer<typeof reportSchema>;
export type CreateReport = z.infer<typeof createReportSchema>;

export const LOCAL_SYNC_STATUSES = [
  "draft",
  "local-only",
  "queued",
  "syncing",
  "synced",
  "error",
] as const;
export type LocalSyncStatus = (typeof LOCAL_SYNC_STATUSES)[number];
