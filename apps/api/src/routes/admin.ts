import { FastifyPluginAsync } from "fastify";
import type { TokenPayload } from "@stroyfoto/shared";
import {
  createProjectSchema,
  updateProjectSchema,
  createDictionaryItemSchema,
  updateDictionaryItemSchema,
  createAreaSchema,
  updateAreaSchema,
} from "@stroyfoto/shared";
import { snakeToCamel, snakeToCamelArray, camelToSnake } from "../utils/case-transform.js";

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // Admin-only guard
  fastify.addHook("onRequest", async (request, reply) => {
    const user = request.user as TokenPayload;
    if (user.role !== "ADMIN") {
      return reply.status(403).send({ error: "Admin access required" });
    }
  });

  // GET /api/admin/users
  fastify.get("/api/admin/users", async () => {
    const { data: users, error } = await fastify.supabase
      .from("users")
      .select("id, username, role, full_name, created_at, updated_at");

    if (error) throw error;
    return snakeToCamelArray(users ?? []);
  });

  // GET /api/admin/stats
  fastify.get("/api/admin/stats", async () => {
    const [reportsRes, photosRes, byProjectRes] = await Promise.all([
      fastify.supabase.from("reports").select("id", { count: "exact", head: true }),
      fastify.supabase.from("photos").select("id", { count: "exact", head: true }).eq("upload_status", "UPLOADED"),
      fastify.supabase.rpc("reports_count_by_project"),
    ]);

    const totalReports = reportsRes.count ?? 0;
    const totalPhotos = photosRes.count ?? 0;
    const reportsByProjectRaw = (byProjectRes.data ?? []) as Array<{ project_id: string; count: number }>;

    // Resolve project names
    const projectIds = reportsByProjectRaw.map((r) => r.project_id);
    let projectMap = new Map<string, { name: string; code: string }>();

    if (projectIds.length > 0) {
      const { data: projects } = await fastify.supabase
        .from("projects")
        .select("id, name, code")
        .in("id", projectIds);

      projectMap = new Map((projects ?? []).map((p) => [p.id, { name: p.name, code: p.code }]));
    }

    const reportsByProject = reportsByProjectRaw.map((r) => ({
      projectId: r.project_id,
      projectName: projectMap.get(r.project_id)?.name ?? r.project_id,
      projectCode: projectMap.get(r.project_id)?.code ?? "",
      count: r.count,
    }));

    return {
      totalReports,
      totalPhotos,
      reportsByProject,
    };
  });

  // GET /api/admin/reports — filtered, paginated
  fastify.get<{
    Querystring: {
      projectId?: string;
      contractor?: string;
      workType?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    };
  }>("/api/admin/reports", async (request) => {
    const { projectId, contractor, workType, from, to } = request.query;
    const page = Math.max(parseInt(request.query.page ?? "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
    const offset = (page - 1) * limit;

    // Build query for reports with related data
    let query = fastify.supabase
      .from("reports")
      .select("*, users!inner(full_name, username), projects!inner(name, code), photos(id)");

    if (projectId) {
      query = query.eq("project_id", projectId);
    }
    if (contractor) {
      query = query.ilike("contractor", `%${contractor}%`);
    }
    if (workType) {
      query = query.eq("work_type", workType);
    }
    if (from) {
      query = query.gte("date_time", from);
    }
    if (to) {
      query = query.lte("date_time", to);
    }

    // Count query
    let countQuery = fastify.supabase
      .from("reports")
      .select("id", { count: "exact", head: true });

    if (projectId) countQuery = countQuery.eq("project_id", projectId);
    if (contractor) countQuery = countQuery.ilike("contractor", `%${contractor}%`);
    if (workType) countQuery = countQuery.eq("work_type", workType);
    if (from) countQuery = countQuery.gte("date_time", from);
    if (to) countQuery = countQuery.lte("date_time", to);

    const [{ data: reports, error }, { count: total }] = await Promise.all([
      query
        .order("date_time", { ascending: false })
        .range(offset, offset + limit - 1),
      countQuery,
    ]);

    if (error) throw error;

    return {
      reports: (reports ?? []).map((r) => {
        const photoCount = (r.photos as Array<unknown>).length;
        const user = r.users as { full_name: string; username: string };
        const project = r.projects as { name: string; code: string };
        const { photos: _, users: _u, projects: _p, ...fields } = r;
        return {
          ...snakeToCamel(fields as Record<string, unknown>),
          user: { fullName: user.full_name, username: user.username },
          project: { name: project.name, code: project.code },
          photoCount,
        };
      }),
      total: total ?? 0,
      page,
      limit,
    };
  });
  // --- Dictionary CRUD ---

  const tableMap: Record<string, string> = {
    projects: "projects",
    workTypes: "work_types",
    contractors: "contractors",
    areas: "areas",
  };

  // GET /api/admin/dictionaries/:type — all records including inactive
  fastify.get<{ Params: { type: string } }>("/api/admin/dictionaries/:type", async (request, reply) => {
    const tableName = tableMap[request.params.type];
    if (!tableName) {
      return reply.status(400).send({ error: "Invalid dictionary type" });
    }

    const { data, error } = await fastify.supabase
      .from(tableName)
      .select("*")
      .order("name");

    if (error) throw error;
    return snakeToCamelArray(data ?? []);
  });

  // POST /api/admin/dictionaries/:type — create record
  fastify.post<{ Params: { type: string } }>("/api/admin/dictionaries/:type", async (request, reply) => {
    const type = request.params.type;
    const tableName = tableMap[type];
    if (!tableName) {
      return reply.status(400).send({ error: "Invalid dictionary type" });
    }

    // Validate with appropriate schema
    const schema =
      type === "projects" ? createProjectSchema :
      type === "areas" ? createAreaSchema :
      createDictionaryItemSchema;

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const insertData = camelToSnake(parsed.data as Record<string, unknown>);

    const { data, error } = await fastify.supabase
      .from(tableName)
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: "Запись с таким именем или кодом уже существует" });
      }
      throw error;
    }

    return reply.status(201).send(snakeToCamel(data as Record<string, unknown>));
  });

  // PUT /api/admin/dictionaries/:type/:id — update record
  fastify.put<{ Params: { type: string; id: string } }>("/api/admin/dictionaries/:type/:id", async (request, reply) => {
    const type = request.params.type;
    const tableName = tableMap[type];
    if (!tableName) {
      return reply.status(400).send({ error: "Invalid dictionary type" });
    }

    const schema =
      type === "projects" ? updateProjectSchema :
      type === "areas" ? updateAreaSchema :
      updateDictionaryItemSchema;

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const updateData = camelToSnake(parsed.data as Record<string, unknown>);

    const { data, error } = await fastify.supabase
      .from(tableName)
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq("id", request.params.id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: "Запись с таким именем или кодом уже существует" });
      }
      if (error.code === "PGRST116") {
        return reply.status(404).send({ error: "Запись не найдена" });
      }
      throw error;
    }

    return snakeToCamel(data as Record<string, unknown>);
  });

  // DELETE /api/admin/dictionaries/:type/:id — soft delete (is_active = false)
  fastify.delete<{ Params: { type: string; id: string } }>("/api/admin/dictionaries/:type/:id", async (request, reply) => {
    const tableName = tableMap[request.params.type];
    if (!tableName) {
      return reply.status(400).send({ error: "Invalid dictionary type" });
    }

    const { error } = await fastify.supabase
      .from(tableName)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", request.params.id);

    if (error) throw error;
    return { success: true };
  });
};

export default adminRoutes;
