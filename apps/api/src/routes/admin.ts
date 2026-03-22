import { FastifyPluginAsync } from "fastify";
import type { AuthUser } from "../plugins/auth.js";
import {
  createProjectSchema,
  updateProjectSchema,
  createDictionaryItemSchema,
  updateDictionaryItemSchema,
  updateUserRoleSchema,
  updateUserProjectsSchema,
} from "@stroyfoto/shared";
import { snakeToCamel, snakeToCamelArray, camelToSnake } from "../utils/case-transform.js";
import { invalidateProfileCache } from "../utils/get-profile.js";

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // Admin-only guard
  fastify.addHook("onRequest", async (request, reply) => {
    const user = request.user as AuthUser;
    if (user.role !== "ADMIN") {
      return reply.status(403).send({ error: "Admin access required" });
    }
  });

  // ============================================================
  // USER MANAGEMENT
  // ============================================================

  // GET /api/admin/users — list all users with assigned project IDs
  fastify.get("/api/admin/users", async () => {
    const { data: users, error } = await fastify.supabase
      .from("profiles")
      .select("id, email, role, full_name, created_at, updated_at");

    if (error) throw error;

    // Fetch all user-project assignments in one query
    const { data: assignments } = await fastify.supabase
      .from("user_projects")
      .select("user_id, project_id");

    const assignmentMap = new Map<string, string[]>();
    for (const a of assignments ?? []) {
      const list = assignmentMap.get(a.user_id) ?? [];
      list.push(a.project_id);
      assignmentMap.set(a.user_id, list);
    }

    return (users ?? []).map((u) => ({
      ...snakeToCamel(u as Record<string, unknown>),
      assignedProjectIds: assignmentMap.get(u.id) ?? [],
    }));
  });

  // PUT /api/admin/users/:id/role — change user role
  fastify.put<{ Params: { id: string } }>("/api/admin/users/:id/role", async (request, reply) => {
    const currentUser = request.user as AuthUser;
    const { id } = request.params;

    // Prevent self-lock
    if (id === currentUser.profileId) {
      return reply.status(400).send({ error: "Нельзя изменить свою собственную роль" });
    }

    const parsed = updateUserRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { role } = parsed.data;

    // Update profile
    const { data: profile, error } = await fastify.supabase
      .from("profiles")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, email, role, full_name, auth_id")
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({ error: "Пользователь не найден" });
      }
      throw error;
    }

    // Update app_metadata in Supabase Auth
    if (profile.auth_id) {
      try {
        await fastify.supabase.auth.admin.updateUserById(profile.auth_id, {
          app_metadata: { app_role: role },
        });
      } catch (e) {
        request.log.warn({ error: e, authId: profile.auth_id }, "Failed to update Supabase Auth app_metadata");
      }

      // Invalidate profile cache
      invalidateProfileCache(profile.auth_id);
    }

    return snakeToCamel(profile as Record<string, unknown>);
  });

  // GET /api/admin/users/:id/projects — get user's assigned projects
  fastify.get<{ Params: { id: string } }>("/api/admin/users/:id/projects", async (request) => {
    const { id } = request.params;

    const { data, error } = await fastify.supabase
      .from("user_projects")
      .select("project_id")
      .eq("user_id", id);

    if (error) throw error;

    return {
      projectIds: (data ?? []).map((r) => r.project_id),
    };
  });

  // PUT /api/admin/users/:id/projects — replace user's project assignments
  fastify.put<{ Params: { id: string } }>("/api/admin/users/:id/projects", async (request, reply) => {
    const { id } = request.params;

    const parsed = updateUserProjectsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { projectIds } = parsed.data;

    // Verify user exists
    const { data: userExists } = await fastify.supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!userExists) {
      return reply.status(404).send({ error: "Пользователь не найден" });
    }

    // Delete current assignments
    await fastify.supabase
      .from("user_projects")
      .delete()
      .eq("user_id", id);

    // Insert new assignments
    if (projectIds.length > 0) {
      const rows = projectIds.map((projectId) => ({
        user_id: id,
        project_id: projectId,
      }));

      const { error } = await fastify.supabase
        .from("user_projects")
        .insert(rows);

      if (error) throw error;
    }

    return { projectIds };
  });

  // ============================================================
  // STATS
  // ============================================================

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
      .select("*, profiles!inner(full_name, email), projects!inner(name, code), photos(id)");

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
        const profile = r.profiles as { full_name: string; email: string };
        const project = r.projects as { name: string; code: string };
        const { photos: _, profiles: _u, projects: _p, ...fields } = r;
        return {
          ...snakeToCamel(fields as Record<string, unknown>),
          user: { fullName: profile.full_name, email: profile.email },
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
    ownForces: "own_forces",
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
