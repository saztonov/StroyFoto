import { FastifyPluginAsync } from "fastify";
import type { TokenPayload } from "@stroyfoto/shared";
import { snakeToCamel, snakeToCamelArray } from "../utils/case-transform.js";

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

  // POST /api/reference/workTypes — create new work type (any authenticated user)
  fastify.post("/api/reference/workTypes", async (request, reply) => {
    const { name } = request.body as { name?: string };
    if (!name || name.trim().length === 0) {
      return reply.status(400).send({ error: "Name is required" });
    }

    // Idempotent: return existing if already exists
    const { data: existing } = await fastify.supabase
      .from("work_types")
      .select("*")
      .ilike("name", name.trim())
      .maybeSingle();

    if (existing) {
      return snakeToCamel(existing as Record<string, unknown>);
    }

    const { data, error } = await fastify.supabase
      .from("work_types")
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        // Race condition: was created between check and insert
        const { data: found } = await fastify.supabase
          .from("work_types")
          .select("*")
          .ilike("name", name.trim())
          .single();
        return snakeToCamel((found ?? {}) as Record<string, unknown>);
      }
      throw error;
    }

    return reply.status(201).send(snakeToCamel(data as Record<string, unknown>));
  });

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

  // GET /api/reference/ownForces
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/ownForces",
    async (request) => {
      const { updatedSince } = request.query;
      let query = fastify.supabase
        .from("own_forces")
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

  // GET /api/dictionaries — combined endpoint with version hashes
  fastify.get("/api/dictionaries", async () => {
    const [projectsRes, workTypesRes, contractorsRes, ownForcesRes] = await Promise.all([
      fastify.supabase.from("projects").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("work_types").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("contractors").select("*").eq("is_active", true).order("name"),
      fastify.supabase.from("own_forces").select("*").eq("is_active", true).order("name"),
    ]);

    const projects = snakeToCamelArray(projectsRes.data ?? []);
    const workTypes = snakeToCamelArray(workTypesRes.data ?? []);
    const contractors = snakeToCamelArray(contractorsRes.data ?? []);
    const ownForces = snakeToCamelArray(ownForcesRes.data ?? []);

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
      ownForces,
      versions: {
        projects: versionOf(projects),
        workTypes: versionOf(workTypes),
        contractors: versionOf(contractors),
        ownForces: versionOf(ownForces),
      },
    };
  });
};

export default dictionariesRoutes;
