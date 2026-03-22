import { FastifyPluginAsync } from "fastify";
import { completeUploadRequestSchema } from "@stroyfoto/shared";

const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // POST /api/uploads/complete
  fastify.post("/api/uploads/complete", async (request, reply) => {
    const parsed = completeUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { photos } = parsed.data;
    const results: Array<{
      clientId: string;
      status: "ok" | "not_found" | "not_uploaded" | "error";
      message?: string;
    }> = [];

    for (const { clientId } of photos) {
      try {
        const { data: photo, error } = await fastify.supabase
          .from("photos")
          .select("*")
          .eq("client_id", clientId)
          .single();

        if (error || !photo) {
          results.push({ clientId, status: "not_found", message: "Photo record not found" });
          continue;
        }

        if (photo.upload_status === "UPLOADED") {
          // Already confirmed — idempotent
          results.push({ clientId, status: "ok" });
          continue;
        }

        // Verify object exists in R2
        const headResult = await fastify.r2.headObject(photo.object_key);

        if (!headResult) {
          results.push({
            clientId,
            status: "not_uploaded",
            message: "Object not found in storage — upload may still be in progress",
          });
          continue;
        }

        const sizeBytes = headResult.contentLength ?? photo.size_bytes;

        await fastify.supabase
          .from("photos")
          .update({
            upload_status: "UPLOADED" as const,
            size_bytes: sizeBytes,
          })
          .eq("client_id", clientId);

        results.push({ clientId, status: "ok" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ clientId, status: "error", message });
      }
    }

    return { results };
  });
};

export default uploadsRoutes;
