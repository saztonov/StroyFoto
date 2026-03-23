import { z } from "zod";

export const bulkDeleteReportsSchema = z.object({
  projectId: z.string().uuid().optional(),
});

export type BulkDeleteReports = z.infer<typeof bulkDeleteReportsSchema>;
