import { FastifyPluginAsync } from "fastify";

const dictionariesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/reference/projects
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/projects",
    async (request) => {
      const { updatedSince } = request.query;
      const where: Record<string, unknown> = { isActive: true };
      if (updatedSince) {
        where.updatedAt = { gt: new Date(updatedSince) };
      }
      return fastify.prisma.project.findMany({ where, orderBy: { name: "asc" } });
    },
  );

  // GET /api/reference/workTypes
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/workTypes",
    async (request) => {
      const { updatedSince } = request.query;
      const where: Record<string, unknown> = { isActive: true };
      if (updatedSince) {
        where.updatedAt = { gt: new Date(updatedSince) };
      }
      return fastify.prisma.workType.findMany({ where, orderBy: { name: "asc" } });
    },
  );

  // GET /api/reference/contractors
  fastify.get<{ Querystring: { updatedSince?: string } }>(
    "/api/reference/contractors",
    async (request) => {
      const { updatedSince } = request.query;
      const where: Record<string, unknown> = { isActive: true };
      if (updatedSince) {
        where.updatedAt = { gt: new Date(updatedSince) };
      }
      return fastify.prisma.contractor.findMany({ where, orderBy: { name: "asc" } });
    },
  );

  // GET /api/reference/areas
  fastify.get<{ Querystring: { updatedSince?: string; projectId?: string } }>(
    "/api/reference/areas",
    async (request) => {
      const { updatedSince, projectId } = request.query;
      const where: Record<string, unknown> = { isActive: true };
      if (updatedSince) {
        where.updatedAt = { gt: new Date(updatedSince) };
      }
      if (projectId) {
        where.projectId = projectId;
      }
      return fastify.prisma.area.findMany({ where, orderBy: { name: "asc" } });
    },
  );

  // GET /api/dictionaries — combined endpoint with version hashes
  fastify.get("/api/dictionaries", async () => {
    const [projects, workTypes, contractors, areas] = await Promise.all([
      fastify.prisma.project.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      fastify.prisma.workType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      fastify.prisma.contractor.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      fastify.prisma.area.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ]);

    const versionOf = (items: { updatedAt: Date }[]): string => {
      if (items.length === 0) return "0";
      const latest = items.reduce((max, item) =>
        item.updatedAt > max ? item.updatedAt : max,
        items[0].updatedAt,
      );
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
