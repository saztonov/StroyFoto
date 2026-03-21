import { FastifyPluginAsync } from "fastify";
import type { TokenPayload } from "@stroyfoto/shared";

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
    const users = await fastify.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return users;
  });

  // GET /api/admin/stats
  fastify.get("/api/admin/stats", async () => {
    const [totalReports, totalPhotos, reportsByProjectRaw] = await Promise.all([
      fastify.prisma.report.count(),
      fastify.prisma.photo.count({ where: { uploadStatus: "UPLOADED" } }),
      fastify.prisma.report.groupBy({
        by: ["projectId"],
        _count: { id: true },
      }),
    ]);

    // Resolve project names
    const projectIds = reportsByProjectRaw.map((r) => r.projectId);
    const projects = await fastify.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, code: true },
    });
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const reportsByProject = reportsByProjectRaw.map((r) => ({
      projectId: r.projectId,
      projectName: projectMap.get(r.projectId)?.name ?? r.projectId,
      projectCode: projectMap.get(r.projectId)?.code ?? "",
      count: r._count.id,
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
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (projectId) {
      where.projectId = projectId;
    }
    if (contractor) {
      where.contractor = { contains: contractor, mode: "insensitive" };
    }
    if (workType) {
      where.workType = workType;
    }
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lte = new Date(to);
      where.dateTime = dateFilter;
    }

    const [reports, total] = await Promise.all([
      fastify.prisma.report.findMany({
        where,
        include: {
          user: { select: { fullName: true, username: true } },
          project: { select: { name: true, code: true } },
          _count: { select: { photos: true } },
        },
        orderBy: { dateTime: "desc" },
        skip,
        take: limit,
      }),
      fastify.prisma.report.count({ where }),
    ]);

    return {
      reports: reports.map((r) => ({
        ...r,
        photoCount: r._count.photos,
        _count: undefined,
      })),
      total,
      page,
      limit,
    };
  });
};

export default adminRoutes;
