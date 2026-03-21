import { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import type { TokenPayload } from "@stroyfoto/shared";

const photosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // POST /api/photos/upload — legacy direct upload (backward compat)
  fastify.post("/api/photos/upload", async (request, reply) => {
    const user = request.user as TokenPayload;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const fields = data.fields;

    const reportClientIdField = fields["reportClientId"];
    const clientIdField = fields["clientId"];

    if (
      !reportClientIdField ||
      !("value" in reportClientIdField) ||
      !clientIdField ||
      !("value" in clientIdField)
    ) {
      return reply.status(400).send({ error: "Missing required fields: reportClientId, clientId" });
    }

    const reportClientId = reportClientIdField.value as string;
    const clientId = clientIdField.value as string;
    const originalFilename = data.filename;
    const mimeType = data.mimetype;

    const objectKey = `${user.sub}/${reportClientId}/${clientId}-${originalFilename}`;

    // Read file buffer
    const buffer = await data.toBuffer();
    const sizeBytes = buffer.length;

    // Upload to MinIO
    await fastify.minio.putObject(config.MINIO_BUCKET, objectKey, buffer, sizeBytes, {
      "Content-Type": mimeType,
    });

    // Find report by clientId
    const report = await fastify.prisma.report.findUnique({
      where: { clientId: reportClientId },
    });

    if (!report) {
      return reply.status(404).send({ error: "Report not found for the given reportClientId" });
    }

    // Idempotent: upsert photo record
    const existingPhoto = await fastify.prisma.photo.findUnique({
      where: { clientId },
    });

    if (existingPhoto) {
      const updated = await fastify.prisma.photo.update({
        where: { clientId },
        data: { uploadStatus: "UPLOADED", sizeBytes },
      });
      return reply.status(200).send(updated);
    }

    const photo = await fastify.prisma.photo.create({
      data: {
        clientId,
        reportId: report.id,
        bucket: config.MINIO_BUCKET,
        objectKey,
        mimeType,
        sizeBytes,
        uploadStatus: "UPLOADED",
      },
    });

    return reply.status(201).send(photo);
  });

  // GET /api/photos/:id — redirect to presigned GET URL
  fastify.get<{ Params: { id: string } }>("/api/photos/:id", async (request, reply) => {
    const { id } = request.params;

    const photo = await fastify.prisma.photo.findUnique({
      where: { id },
    });

    if (!photo) {
      return reply.status(404).send({ error: "Photo not found" });
    }

    if (photo.uploadStatus === "PENDING_UPLOAD") {
      return reply.status(404).send({ error: "Photo upload not yet completed" });
    }

    const presignedUrl = await fastify.minio.presignedGetObject(
      photo.bucket,
      photo.objectKey,
      3600,
    );

    return reply.redirect(presignedUrl);
  });
};

export default photosRoutes;
