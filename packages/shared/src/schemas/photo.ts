import { z } from "zod";

export const photoSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  reportId: z.string().uuid(),
  bucket: z.string(),
  objectKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.coerce.date(),
});

export type Photo = z.infer<typeof photoSchema>;
