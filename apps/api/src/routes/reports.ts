import { FastifyPluginAsync } from "fastify";
import { createReportSchema } from "@stroyfoto/shared";
import type { TokenPayload } from "@stroyfoto/shared";

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastify.authenticate);

  // GET /api/reports
  fastify.get<{
    Querystring: { projectId?: string; from?: string; to?: string };
  }>("/api/reports", async (request) => {
    const user = request.user as TokenPayload;
    const { projectId, from, to } = request.query;

    const where: Record<string, unknown> = {};

    // Admin sees all, Worker sees own
    if (user.role !== "ADMIN") {
      where.userId = user.sub;
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lte = new Date(to);
      where.dateTime = dateFilter;
    }

    const reports = await fastify.prisma.report.findMany({
      where,
      include: {
        _count: {
          select: { photos: true },
        },
      },
      orderBy: { dateTime: "desc" },
    });

    return reports.map((r: Record<string, unknown> & { _count: { photos: number } }) => ({
      ...r,
      photoCount: r._count.photos,
      _count: undefined,
    }));
  });

  // GET /api/reports/:id
  fastify.get<{ Params: { id: string } }>("/api/reports/:id", async (request, reply) => {
    const user = request.user as TokenPayload;
    const { id } = request.params;

    const report = await fastify.prisma.report.findUnique({
      where: { id },
      include: { photos: { where: { uploadStatus: "UPLOADED" } } },
    });

    if (!report) {
      return reply.status(404).send({ error: "Report not found" });
    }

    if (user.role !== "ADMIN" && report.userId !== user.sub) {
      return reply.status(403).send({ error: "Access denied" });
    }

    return report;
  });

  // POST /api/reports
  fastify.post("/api/reports", async (request, reply) => {
    const user = request.user as TokenPayload;

    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const report = await fastify.prisma.report.create({
      data: {
        ...parsed.data,
        userId: user.sub,
      },
    });

    return reply.status(201).send(report);
  });

  // POST /api/reports/:id/finalize
  fastify.post<{ Params: { id: string } }>("/api/reports/:id/finalize", async (request, reply) => {
    const user = request.user as TokenPayload;
    const { id } = request.params;

    const report = await fastify.prisma.report.findUnique({
      where: { id },
      include: { photos: true },
    });

    if (!report) {
      return reply.status(404).send({ error: "Report not found" });
    }

    if (user.role !== "ADMIN" && report.userId !== user.sub) {
      return reply.status(403).send({ error: "Access denied" });
    }

    const pendingPhotos = report.photos.filter((p) => p.uploadStatus === "PENDING_UPLOAD");
    if (pendingPhotos.length > 0) {
      return reply.status(409).send({
        error: "Some photos are not yet uploaded",
        pendingPhotoClientIds: pendingPhotos.map((p) => p.clientId),
      });
    }

    return { status: "finalized" };
  });
};

export default reportsRoutes;
