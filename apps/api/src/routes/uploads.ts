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
        const photo = await fastify.prisma.photo.findUnique({
          where: { clientId },
        });

        if (!photo) {
          results.push({ clientId, status: "not_found", message: "Photo record not found" });
          continue;
        }

        if (photo.uploadStatus === "UPLOADED") {
          // Already confirmed — idempotent
          results.push({ clientId, status: "ok" });
          continue;
        }

        // Verify object exists in MinIO
        try {
          const stat = await fastify.minio.statObject(photo.bucket, photo.objectKey);

          await fastify.prisma.photo.update({
            where: { clientId },
            data: {
              uploadStatus: "UPLOADED",
              sizeBytes: stat.size,
            },
          });

          results.push({ clientId, status: "ok" });
        } catch {
          results.push({
            clientId,
            status: "not_uploaded",
            message: "Object not found in storage — upload may still be in progress",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ clientId, status: "error", message });
      }
    }

    return { results };
  });
};

export default uploadsRoutes;
