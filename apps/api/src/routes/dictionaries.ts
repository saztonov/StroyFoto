import { FastifyPluginAsync } from "fastify";
import { snakeToCamelArray } from "../utils/case-transform.js";

const dictionariesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/reference/projects
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/projects",
    async (request) => {
      const { updatedSince } = request.query;
      let query = fastify.supabase
        .from("projects")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (updatedSince) {
        query = query.gt("updated_at", updatedSince);
      }

      const { data, error } = await query;
      if (error) throw error;
      return snakeToCamelArray(data ?? []);
    },
  );

  // GET /api/reference/workTypes
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/workTypes",
    async (request) => {
      const { updatedSince } = request.query;
      let query = fastify.supabase
        .from("work_types")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (updatedSince) {
        query = query.gt("updated_at", updatedSince);
      }

      const { data, error } = await query;
      if (error) throw error;
      return snakeToCamelArray(data ?? []);
    },
  );

  // GET /api/reference/contractors
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/contractors",
    async (request) => {
      const { updatedSince } = request.query;
      let query = fastify.supabase
        .from("contractors")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (updatedSince) {
        query = query.gt("updated_at", updatedSince);
      }

      const { data, error } = await query;
      if (error) throw error;
      return snakeToCamelArray(data ?? []);
    },
  );

  // GET /api/reference/areas
  fastify.get<{ Querystring: { updatedSince?: string; projectId?: string } }>(
    "/api/reference/areas",
    async (request) => {
      const { updatedSince, projectId } = request.query;
      let query = fastify.supabase
        .from("areas")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (updatedSince) {
        query = query.gt("updated_at", updatedSince);
      }
      if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return snakeToCamelArray(data ?? []);
    },
  );

  // GET /api/dictionaries — combined endpoint with version hashes
  fastify.get("/api/dictionaries", async () => {
    const [projectsRes, workTypesRes, contractorsRes, areasRes] = await Promise.all([
      fastify.supabase.from("projects").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("work_types").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("contractors").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("areas").select("*").eq("is_active", true).order("name"),
    ]);

    const projects = snakeToCamelArray(projectsRes.data ?? []);
    const workTypes = snakeToCamelArray(workTypesRes.data ?? []);
    const contractors = snakeToCamelArray(contractorsRes.data ?? []);
    const areas = snakeToCamelArray(areasRes.data ?? []);

    const versionOf = (items: Record<string, unknown>[]): string => {
      if (items.length === 0) return "0";
      const updatedAts = items.map((item) => new Date(item.updatedAt as string));
      const latest = updatedAts.reduce((max, d) => (d > max ? d : max), updatedAts[0]);
      return latest.toISOString();
    };

    return {
      projects,
      workTypes,
      contractors,
      areas,
      versions: {
        projects: versionOf(projects),
        workTypes: versionOf(workTypes),
        contractors: versionOf(contractors),
        areas: versionOf(areas),
      },
    };
  });
};

export default dictionariesRoutes;
