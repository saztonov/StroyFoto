import { z } from "zod";

export const completeUploadRequestSchema = z.object({
  photos: z.array(
    z.object({
      clientId: z.string().uuid(),
    })
  ).min(1),
});

export const completeUploadResponseSchema = z.object({
  results: z.array(
    z.object({
      clientId: z.string().uuid(),
      status: z.enum(["ok", "not_found", "not_uploaded", "error"]),
      message: z.string().optional(),
    })
  ),
});

export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;
