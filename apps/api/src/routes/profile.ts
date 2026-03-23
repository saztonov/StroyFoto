import { FastifyPluginAsync } from "fastify";
import type { AuthUser } from "../plugins/auth.js";
import { snakeToCamel } from "../utils/case-transform.js";

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/profile — get current user's profile
  fastify.get("/api/profile", async (request, reply) => {
    const user = request.user as AuthUser;

    const { data: profile, error } = await fastify.supabase
      .from("profiles")
      .select("id, email, role, full_name, created_at, updated_at")
      .eq("id", user.profileId)
      .single();

    if (error || !profile) {
      return reply.status(404).send({ error: "Profile not found" });
    }

    return snakeToCamel(profile as Record<string, unknown>);
  });

  // GET /api/profile/stats — user's projects, report count, photo count
  fastify.get("/api/profile/stats", async (request, reply) => {
    const user = request.user as AuthUser;

    const [reportsRes, photosRes, projectsRes] = await Promise.all([
      fastify.supabase
        .from("reports")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.profileId),
      fastify.supabase
        .from("photos")
        .select("*, reports!inner(user_id)", { count: "exact", head: true })
        .eq("reports.user_id", user.profileId),
      user.role === "ADMIN"
        ? Promise.resolve({ data: [] })
        : fastify.supabase
            .from("user_projects")
            .select("projects(id, name)")
            .eq("user_id", user.profileId),
    ]);

    const projects =
      user.role === "ADMIN"
        ? []
        : (projectsRes.data ?? []).map((row: Record<string, unknown>) => row.projects);

    return {
      reportCount: reportsRes.count ?? 0,
      photoCount: photosRes.count ?? 0,
      projects,
    };
  });

  // PUT /api/profile — update current user's profile (fullName only)
  fastify.put("/api/profile", async (request, reply) => {
    const user = request.user as AuthUser;
    const { fullName } = request.body as { fullName?: string };

    if (!fullName || fullName.trim().length === 0) {
      return reply.status(400).send({ error: "fullName is required" });
    }

    const { data: profile, error } = await fastify.supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), updated_at: new Date().toISOString() })
      .eq("id", user.profileId)
      .select("id, email, role, full_name, created_at, updated_at")
      .single();

    if (error) throw error;

    return snakeToCamel(profile as Record<string, unknown>);
  });
};

export default profileRoutes;
