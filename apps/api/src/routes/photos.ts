import { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import type { AuthUser } from "../plugins/auth.js";
import { snakeToCamel } from "../utils/case-transform.js";


const photosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // POST /api/photos/upload — legacy direct upload (backward compat)
  fastify.post("/api/photos/upload", async (request, reply) => {
    const user = request.user as AuthUser;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const originalFilename = data.filename;
    const mimeType = data.mimetype;

    // Read file buffer first to ensure all multipart fields are parsed
    const buffer = await data.toBuffer();
    const sizeBytes = buffer.length;

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

    request.log.info({ clientId, reportClientId, filename: originalFilename, mimeType, sizeBytes }, "photos/upload: starting");

    const objectKey = `${user.profileId}/${reportClientId}/${clientId}-${originalFilename}`;

    // Upload to R2
    await fastify.r2.upload(objectKey, buffer, mimeType);

    request.log.info({ objectKey }, "photos/upload: file uploaded to storage");

    // Find report by clientId
    const { data: report, error: reportErr } = await fastify.supabase
      .from("reports")
      .select("id")
      .eq("client_id", reportClientId)
      .single();

    if (reportErr || !report) {
      request.log.error({ reportClientId, error: reportErr?.message }, "photos/upload: report not found");
      return reply.status(404).send({ error: "Report not found for the given reportClientId" });
    }

    // Idempotent: check if photo exists
    const { data: existingPhoto } = await fastify.supabase
      .from("photos")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (existingPhoto) {
      const { data: updated, error: updateErr } = await fastify.supabase
        .from("photos")
        .update({ upload_status: "UPLOADED" as const, size_bytes: sizeBytes })
        .eq("client_id", clientId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return reply.status(200).send(snakeToCamel(updated as Record<string, unknown>));
    }

    const { data: photo, error: createErr } = await fastify.supabase
      .from("photos")
      .insert({
        client_id: clientId,
        report_id: report.id,
        bucket: config.R2_BUCKET_NAME,
        object_key: objectKey,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        upload_status: "UPLOADED",
      })
      .select()
      .single();

    if (createErr) throw createErr;
    return reply.status(201).send(snakeToCamel(photo as Record<string, unknown>));
  });

  // GET /api/photos/:id — proxy photo from R2 (avoids CORS issues with presigned redirects)
  fastify.get<{ Params: { id: string } }>("/api/photos/:id", async (request, reply) => {
    const user = request.user as AuthUser;
    const { id } = request.params;

    const { data: photo, error } = await fastify.supabase
      .from("photos")
      .select("*, reports!inner(project_id, user_id)")
      .eq("id", id)
      .single();

    if (error || !photo) {
      return reply.status(404).send({ error: "Photo not found" });
    }

    if (photo.upload_status === "PENDING_UPLOAD") {
      return reply.status(404).send({ error: "Photo upload not yet completed" });
    }

    // Access check: verify user can access the parent report's project
    if (user.role !== "ADMIN") {
      const { getUserProjectIds } = await import("../utils/project-access.js");
      const accessibleProjectIds = await getUserProjectIds(fastify.supabase, user.profileId, user.role);
      const reportProjectId = (photo.reports as Record<string, unknown>)?.project_id as string;
      if (accessibleProjectIds !== null && !accessibleProjectIds.includes(reportProjectId)) {
        return reply.status(403).send({ error: "Access denied" });
      }
    }

    const obj = await fastify.r2.download(photo.object_key);
    if (!obj) {
      return reply.status(404).send({ error: "Photo file not found in storage" });
    }

    return reply
      .header("Content-Type", obj.contentType)
      .header("Cache-Control", "private, no-store")
      .send(obj.body);
  });
};

export default photosRoutes;
