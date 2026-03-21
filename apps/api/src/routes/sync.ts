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
import { snakeToCamel, snakeToCamelArray } from "../utils/case-transform.js";

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

        // Idempotent: check if report exists
        const { data: existing } = await fastify.supabase
          .from("reports")
          .select("*")
          .eq("client_id", reportFields.clientId)
          .maybeSingle();

        let report;
        if (existing) {
          report = existing;
          results.push({
            clientId: reportFields.clientId,
            status: "exists",
            serverId: existing.id,
          });
        } else {
          const { data: created, error: createErr } = await fastify.supabase
            .from("reports")
            .insert({
              client_id: reportFields.clientId,
              project_id: reportFields.projectId,
              date_time: reportFields.dateTime,
              mark: reportFields.mark,
              work_type: reportFields.workType,
              area: reportFields.area,
              contractor: reportFields.contractor,
              description: reportFields.description ?? "",
              user_id: user.sub,
              sync_status: "SYNCED",
            })
            .select()
            .single();

          if (createErr || !created) {
            throw createErr ?? new Error("Failed to create report");
          }

          report = created;
          results.push({
            clientId: reportFields.clientId,
            status: "created",
            serverId: created.id,
          });
        }

        // Process photo metadata — upsert each, generate presigned PUT URLs
        for (const photoMeta of photos) {
          const objectKey = `${user.sub}/${reportFields.clientId}/${photoMeta.clientId}-${photoMeta.fileName}`;

          const { data: existingPhoto } = await fastify.supabase
            .from("photos")
            .select("*")
            .eq("client_id", photoMeta.clientId)
            .maybeSingle();

          if (existingPhoto) {
            // Photo record already exists — if still pending, re-issue presigned URL
            if (existingPhoto.upload_status === "PENDING_UPLOAD") {
              const { data: signedData } = await fastify.supabase.storage
                .from(config.SUPABASE_STORAGE_BUCKET)
                .createSignedUploadUrl(existingPhoto.object_key);

              if (signedData) {
                presignedUrls[photoMeta.clientId] = signedData.signedUrl;
              }
            }
            // If UPLOADED, skip — idempotent
            continue;
          }

          await fastify.supabase.from("photos").insert({
            client_id: photoMeta.clientId,
            report_id: report.id,
            bucket: config.SUPABASE_STORAGE_BUCKET,
            object_key: objectKey,
            mime_type: photoMeta.mimeType,
            size_bytes: photoMeta.sizeBytes,
            upload_status: "PENDING_UPLOAD",
          });

          const { data: signedData } = await fastify.supabase.storage
            .from(config.SUPABASE_STORAGE_BUCKET)
            .createSignedUploadUrl(objectKey);

          if (signedData) {
            presignedUrls[photoMeta.clientId] = signedData.signedUrl;
          }
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

      let query = fastify.supabase
        .from("reports")
        .select("*, photos(*)")
        .eq("sync_status", "SYNCED");

      // Worker sees own reports, admin sees all
      if (user.role !== "ADMIN") {
        query = query.eq("user_id", user.sub);
      }

      if (cursor) {
        query = query.gt("updated_at", cursor);
      }

      const { data: rawReports, error } = await query
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit + 1);

      if (error) throw error;

      const allReports = rawReports ?? [];
      const hasMore = allReports.length > limit;
      const slice = hasMore ? allReports.slice(0, limit) : allReports;

      // Filter photos to only UPLOADED and transform to camelCase
      const reports = slice.map((r) => {
        const photos = (r.photos as Array<Record<string, unknown>>)
          .filter((p) => p.upload_status === "UPLOADED");
        const { photos: _, ...reportFields } = r;
        return {
          ...snakeToCamel(reportFields as Record<string, unknown>),
          photos: snakeToCamelArray(photos),
        };
      });

      const nextCursor = slice.length > 0
        ? slice[slice.length - 1].updated_at
        : null;

      return {
        reports,
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
      request.log.warn({ details: parsed.error.flatten() }, "sync/batch: invalid request body");
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { items } = parsed.data;
    const results: SyncBatchResponse["results"] = [];

    for (const item of items) {
      try {
        if (item.entityType === "report" && item.action === "create") {
          const reportParsed = createReportSchema.safeParse(item.payload);
          if (!reportParsed.success) {
            request.log.warn({ entityClientId: item.entityClientId, errors: reportParsed.error.flatten() }, "sync/batch: invalid report payload");
            results.push({
              entityClientId: item.entityClientId,
              status: "error",
              message: "Invalid report payload",
            });
            continue;
          }

          const data = reportParsed.data;

          request.log.info({ clientId: data.clientId, projectId: data.projectId, userId: user.sub }, "sync/batch: upserting report");

          // Idempotent upsert
          const { data: report, error } = await fastify.supabase
            .from("reports")
            .upsert(
              {
                client_id: data.clientId,
                project_id: data.projectId,
                date_time: data.dateTime,
                mark: data.mark,
                work_type: data.workType,
                area: data.area,
                contractor: data.contractor,
                description: data.description ?? "",
                user_id: user.sub,
                sync_status: "SYNCED",
              },
              { onConflict: "client_id", ignoreDuplicates: true },
            )
            .select()
            .single();

          if (error) {
            request.log.warn({ error: error.message, code: error.code, clientId: data.clientId }, "sync/batch: upsert returned error, fetching existing");

            // Try to fetch existing record (upsert may fail due to ignoreDuplicates returning no row)
            const { data: existing, error: fetchErr } = await fastify.supabase
              .from("reports")
              .select("id")
              .eq("client_id", data.clientId)
              .maybeSingle();

            if (existing?.id) {
              request.log.info({ clientId: data.clientId, serverId: existing.id }, "sync/batch: found existing report");
              results.push({
                entityClientId: item.entityClientId,
                status: "ok",
                serverId: existing.id,
              });
            } else {
              // Real error (e.g. FK violation) — no existing record either
              request.log.error({ error: error.message, code: error.code, fetchErr: fetchErr?.message, clientId: data.clientId }, "sync/batch: upsert failed and no existing record found");
              results.push({
                entityClientId: item.entityClientId,
                status: "error",
                message: error.message ?? "Failed to create report",
              });
            }
          } else {
            request.log.info({ clientId: data.clientId, serverId: report.id }, "sync/batch: report created");
            results.push({
              entityClientId: item.entityClientId,
              status: "ok",
              serverId: report.id,
            });
          }
        } else {
          results.push({
            entityClientId: item.entityClientId,
            status: "error",
            message: `Unsupported operation: ${item.entityType}/${item.action}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        request.log.error({ entityClientId: item.entityClientId, error: message }, "sync/batch: uncaught error");
        results.push({
          entityClientId: item.entityClientId,
          status: "error",
          message,
        });
      }
    }

    request.log.info({ results }, "sync/batch: completed");
    return { results };
  });
};

export default syncRoutes;
