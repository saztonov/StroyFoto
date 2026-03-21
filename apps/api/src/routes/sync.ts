import { FastifyPluginAsync } from "fastify";
import {
  syncBatchRequestSchema,
  createReportSchema,
  syncPushRequestSchema,
} from "@stroyfoto/shared";
import type {
  TokenPayload,
  SyncBatchResponse,
  SyncPushResponse,
  SyncPushResult,
} from "@stroyfoto/shared";
import { config } from "../config.js";

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // ============================================================
  // POST /api/sync/push — new presigned-URL flow
  // ============================================================
  fastify.post("/api/sync/push", async (request, reply) => {
    const user = request.user as TokenPayload;

    const parsed = syncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { reports } = parsed.data;
    const results: SyncPushResult[] = [];
    const presignedUrls: Record<string, string> = {};

    for (const reportData of reports) {
      try {
        const { photos, ...reportFields } = reportData;

        // Idempotent upsert: update:{} means existing reports are untouched (append-only)
        const existing = await fastify.prisma.report.findUnique({
          where: { clientId: reportFields.clientId },
        });

        let report;
        if (existing) {
          report = existing;
          results.push({
            clientId: reportFields.clientId,
            status: "exists",
            serverId: existing.id,
          });
        } else {
          report = await fastify.prisma.report.create({
            data: {
              ...reportFields,
              userId: user.sub,
              syncStatus: "SYNCED",
            },
          });
          results.push({
            clientId: reportFields.clientId,
            status: "created",
            serverId: report.id,
          });
        }

        // Process photo metadata — upsert each, generate presigned PUT URLs
        for (const photoMeta of photos) {
          const objectKey = `${user.sub}/${reportFields.clientId}/${photoMeta.clientId}-${photoMeta.fileName}`;

          const existingPhoto = await fastify.prisma.photo.findUnique({
            where: { clientId: photoMeta.clientId },
          });

          if (existingPhoto) {
            // Photo record already exists — if still pending, re-issue presigned URL
            if (existingPhoto.uploadStatus === "PENDING_UPLOAD") {
              const url = await fastify.minio.presignedPutObject(
                config.MINIO_BUCKET,
                existingPhoto.objectKey,
                config.PRESIGNED_URL_EXPIRY,
              );
              presignedUrls[photoMeta.clientId] = url;
            }
            // If UPLOADED, skip — idempotent
            continue;
          }

          await fastify.prisma.photo.create({
            data: {
              clientId: photoMeta.clientId,
              reportId: report.id,
              bucket: config.MINIO_BUCKET,
              objectKey,
              mimeType: photoMeta.mimeType,
              sizeBytes: photoMeta.sizeBytes,
              uploadStatus: "PENDING_UPLOAD",
            },
          });

          const url = await fastify.minio.presignedPutObject(
            config.MINIO_BUCKET,
            objectKey,
            config.PRESIGNED_URL_EXPIRY,
          );
          presignedUrls[photoMeta.clientId] = url;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({
          clientId: reportData.clientId,
          status: "error",
          message,
        });
      }
    }

    const response: SyncPushResponse = { results, presignedUrls };
    return response;
  });

  // ============================================================
  // GET /api/sync/pull?cursor=...&limit=...
  // ============================================================
  fastify.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/sync/pull",
    async (request) => {
      const user = request.user as TokenPayload;
      const cursor = request.query.cursor;
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);

      const where: Record<string, unknown> = {
        syncStatus: "SYNCED",
      };

      // Worker sees own reports, admin sees all
      if (user.role !== "ADMIN") {
        where.userId = user.sub;
      }

      if (cursor) {
        where.updatedAt = { gt: new Date(cursor) };
      }

      const reports = await fastify.prisma.report.findMany({
        where,
        include: {
          photos: {
            where: { uploadStatus: "UPLOADED" },
          },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit + 1,
      });

      const hasMore = reports.length > limit;
      const slice = hasMore ? reports.slice(0, limit) : reports;
      const nextCursor = slice.length > 0
        ? slice[slice.length - 1].updatedAt.toISOString()
        : null;

      return {
        reports: slice,
        nextCursor,
        hasMore,
      };
    },
  );

  // ============================================================
  // POST /api/sync/batch — legacy endpoint (backward compat)
  // ============================================================
  fastify.post("/api/sync/batch", async (request, reply) => {
    const user = request.user as TokenPayload;

    const parsed = syncBatchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { items } = parsed.data;
    const results: SyncBatchResponse["results"] = [];

    for (const item of items) {
      try {
        if (item.entityType === "report" && item.action === "create") {
          const reportParsed = createReportSchema.safeParse(item.payload);
          if (!reportParsed.success) {
            results.push({
              entityClientId: item.entityClientId,
              status: "error",
              message: "Invalid report payload",
            });
            continue;
          }

          const report = await fastify.prisma.report.upsert({
            where: { clientId: reportParsed.data.clientId },
            update: {},
            create: {
              ...reportParsed.data,
              userId: user.sub,
              syncStatus: "SYNCED",
            },
          });

          results.push({
            entityClientId: item.entityClientId,
            status: "ok",
            serverId: report.id,
          });
        } else {
          results.push({
            entityClientId: item.entityClientId,
            status: "error",
            message: `Unsupported operation: ${item.entityType}/${item.action}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({
          entityClientId: item.entityClientId,
          status: "error",
          message,
        });
      }
    }

    return { results };
  });
};

export default syncRoutes;
