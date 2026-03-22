import { FastifyPluginAsync } from "fastify";
import { createReportSchema } from "@stroyfoto/shared";
import type { AuthUser } from "../plugins/auth.js";
import { snakeToCamel, snakeToCamelArray } from "../utils/case-transform.js";
import { getUserProjectIds, projectIdsForFilter } from "../utils/project-access.js";

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/reports
  fastify.get<{
    Querystring: { projectId?: string; from?: string; to?: string };
  }>("/api/reports", async (request) => {
    const user = request.user as AuthUser;
    const { projectId, from, to } = request.query;

    const accessibleProjectIds = await getUserProjectIds(fastify.supabase, user.profileId, user.role);
    const filterIds = projectIdsForFilter(accessibleProjectIds);

    let query = fastify.supabase
      .from("reports")
      .select("*, photos(id)");

    // Worker sees all reports in assigned projects (not just own);
    // Admin sees all reports across all projects.
    // Project access filtering handles visibility for workers.
    if (filterIds !== null) {
      query = query.in("project_id", filterIds);
    }

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    if (from) {
      query = query.gte("date_time", from);
    }
    if (to) {
      query = query.lte("date_time", to);
    }

    const { data: reports, error } = await query.order("date_time", { ascending: false });
    if (error) throw error;

    return (reports ?? []).map((r) => {
      const photoCount = (r.photos as Array<unknown>).length;
      const { photos: _, ...fields } = r;
      return {
        ...snakeToCamel(fields as Record<string, unknown>),
        photoCount,
      };
    });
  });

  // GET /api/reports/:id
  fastify.get<{ Params: { id: string } }>("/api/reports/:id", async (request, reply) => {
    const user = request.user as AuthUser;
    const { id } = request.params;

    const { data: report, error } = await fastify.supabase
      .from("reports")
      .select("*, photos(*)")
      .eq("id", id)
      .single();

    if (error || !report) {
      return reply.status(404).send({ error: "Report not found" });
    }

    // Check project access for workers (workers see all reports in assigned projects)
    if (user.role !== "ADMIN") {
      const accessibleProjectIds = await getUserProjectIds(fastify.supabase, user.profileId, user.role);
      if (accessibleProjectIds !== null && !accessibleProjectIds.includes(report.project_id)) {
        return reply.status(403).send({ error: "Access denied" });
      }
    }

    // Filter uploaded photos only
    const photos = (report.photos as Array<Record<string, unknown>>)
      .filter((p) => p.upload_status === "UPLOADED");

    const reportObj = { ...report } as Record<string, unknown>;
    delete reportObj.photos;
    const camelReport = snakeToCamel<Record<string, unknown>>(reportObj);
    return {
      ...camelReport,
      photos: snakeToCamelArray(photos),
    };
  });

  // POST /api/reports
  fastify.post("/api/reports", async (request, reply) => {
    const user = request.user as AuthUser;

    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // Check project access for workers
    if (user.role !== "ADMIN") {
      const accessibleProjectIds = await getUserProjectIds(fastify.supabase, user.profileId, user.role);
      if (accessibleProjectIds !== null && !accessibleProjectIds.includes(data.projectId)) {
        return reply.status(403).send({ error: "У вас нет доступа к этому проекту" });
      }
    }

    const { data: report, error } = await fastify.supabase
      .from("reports")
      .insert({
        client_id: data.clientId,
        project_id: data.projectId,
        date_time: data.dateTime,
        work_types: data.workTypes,
        contractor: data.contractor,
        own_forces: data.ownForces ?? "",
        description: data.description ?? "",
        user_id: user.profileId,
      })
      .select()
      .single();

    if (error) throw error;

    return reply.status(201).send(snakeToCamel(report as Record<string, unknown>));
  });

  // POST /api/reports/:id/finalize
  fastify.post<{ Params: { id: string } }>("/api/reports/:id/finalize", async (request, reply) => {
    const user = request.user as AuthUser;
    const { id } = request.params;

    const { data: report, error } = await fastify.supabase
      .from("reports")
      .select("*, photos(*)")
      .eq("id", id)
      .single();

    if (error || !report) {
      return reply.status(404).send({ error: "Report not found" });
    }

    if (user.role !== "ADMIN" && report.user_id !== user.profileId) {
      return reply.status(403).send({ error: "Access denied" });
    }

    const photos = report.photos as Array<Record<string, unknown>>;
    const pendingPhotos = photos.filter((p) => p.upload_status === "PENDING_UPLOAD");
    if (pendingPhotos.length > 0) {
      return reply.status(409).send({
        error: "Some photos are not yet uploaded",
        pendingPhotoClientIds: pendingPhotos.map((p) => p.client_id),
      });
    }

    return { status: "finalized" };
  });

  // DELETE /api/reports/by-client/:clientId
  fastify.delete<{ Params: { clientId: string } }>("/api/reports/by-client/:clientId", async (request, reply) => {
    const user = request.user as AuthUser;
    const { clientId } = request.params;

    const { data: report, error } = await fastify.supabase
      .from("reports")
      .select("id, user_id")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error) throw error;
    if (!report) {
      return reply.status(404).send({ error: "Report not found" });
    }

    if (user.role !== "ADMIN" && report.user_id !== user.profileId) {
      return reply.status(403).send({ error: "Access denied" });
    }

    // Delete photos from storage and DB
    const { data: photos } = await fastify.supabase
      .from("photos")
      .select("id, object_key, bucket")
      .eq("report_id", report.id);

    if (photos && photos.length > 0) {
      // Delete from R2
      const objectKeys = photos.map((p) => p.object_key).filter(Boolean);
      if (objectKeys.length > 0) {
        await fastify.r2.deleteObjects(objectKeys);
      }
      // Delete photo records
      await fastify.supabase.from("photos").delete().eq("report_id", report.id);
    }

    // Delete report
    await fastify.supabase.from("reports").delete().eq("id", report.id);

    return { success: true };
  });
};

export default reportsRoutes;
