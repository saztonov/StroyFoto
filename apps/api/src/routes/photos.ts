import { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import type { TokenPayload } from "@stroyfoto/shared";
import { snakeToCamel } from "../utils/case-transform.js";

const photosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // POST /api/photos/upload — legacy direct upload (backward compat)
  fastify.post("/api/photos/upload", async (request, reply) => {
    const user = request.user as TokenPayload;

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

    request.log.info({ clientId, reportClientId, filename: originalFilename, mimeType, sizeBytes, bucket: config.SUPABASE_STORAGE_BUCKET }, "photos/upload: starting");

    const objectKey = `${user.sub}/${reportClientId}/${clientId}-${originalFilename}`;

    // Upload to Supabase Storage
    const { error: uploadErr } = await fastify.supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .upload(objectKey, buffer, { contentType: mimeType, upsert: true });

    if (uploadErr) {
      request.log.error({ error: uploadErr.message, objectKey, bucket: config.SUPABASE_STORAGE_BUCKET }, "photos/upload: Supabase Storage upload failed");
      throw uploadErr;
    }

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
        bucket: config.SUPABASE_STORAGE_BUCKET,
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

  // GET /api/photos/:id — redirect to presigned GET URL
  fastify.get<{ Params: { id: string } }>("/api/photos/:id", async (request, reply) => {
    const { id } = request.params;

    const { data: photo, error } = await fastify.supabase
      .from("photos")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !photo) {
      return reply.status(404).send({ error: "Photo not found" });
    }

    if (photo.upload_status === "PENDING_UPLOAD") {
      return reply.status(404).send({ error: "Photo upload not yet completed" });
    }

    const { data: signedData, error: signErr } = await fastify.supabase.storage
      .from(photo.bucket)
      .createSignedUrl(photo.object_key, config.PRESIGNED_URL_EXPIRY);

    if (signErr || !signedData) {
      return reply.status(500).send({ error: "Failed to generate download URL" });
    }

    return reply.redirect(signedData.signedUrl);
  });
};

export default photosRoutes;
