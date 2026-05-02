import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import {
  idParamsSchema,
  isoDateSchema,
  parseBody,
  parseParams,
  parseQuery,
  uuidSchema,
} from '../http/validate.js';
import {
  clearPlanMark,
  createReport,
  deleteReport,
  getReportById,
  listReports,
  setPlanMark,
  updateReportWithOcc,
} from '../services/reportsService.js';

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const createSchema = z.object({
  id: uuidSchema,
  project_id: uuidSchema,
  work_type_id: uuidSchema,
  performer_id: uuidSchema,
  work_assignment_id: uuidSchema.nullable().optional(),
  plan_id: uuidSchema.nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  taken_at: isoDateSchema.nullable().optional(),
  author_id: uuidSchema.optional(),
});

const updateSchema = z.object({
  expectedUpdatedAt: isoDateSchema.nullable().optional(),
  work_type_id: uuidSchema.optional(),
  performer_id: uuidSchema.optional(),
  work_assignment_id: uuidSchema.nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  taken_at: isoDateSchema.nullable().optional(),
  plan_id: uuidSchema.nullable().optional(),
});

const planMarkSchema = z.object({
  plan_id: uuidSchema,
  page: z.number().int().positive(),
  x_norm: z.number().min(0).max(1),
  y_norm: z.number().min(0).max(1),
});

export default async function reportsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/', guard, async (request) => {
    const q = parseQuery(listQuerySchema, request.query);
    return listReports({
      user: request.user!,
      cursor: q.cursor ?? null,
      limit: q.limit ?? 200,
    });
  });

  app.get('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    return { report: await getReportById({ user: request.user!, id }) };
  });

  app.post('/', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    const report = await createReport({
      user: request.user!,
      id: body.id,
      project_id: body.project_id,
      work_type_id: body.work_type_id,
      performer_id: body.performer_id,
      work_assignment_id: body.work_assignment_id ?? null,
      plan_id: body.plan_id ?? null,
      description: body.description ?? null,
      taken_at: body.taken_at ?? null,
      author_id: body.author_id ?? null,
    });
    return { report };
  });

  app.patch('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(updateSchema, request.body);
    const report = await updateReportWithOcc({
      user: request.user!,
      id,
      expectedUpdatedAt: body.expectedUpdatedAt ?? null,
      work_type_id: body.work_type_id,
      performer_id: body.performer_id,
      work_assignment_id: body.work_assignment_id,
      description: body.description,
      taken_at: body.taken_at,
      plan_id: body.plan_id,
    });
    return { report };
  });

  app.delete('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    await deleteReport({ user: request.user!, id });
    return { ok: true };
  });

  app.put('/:id/plan-mark', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(planMarkSchema, request.body);
    return setPlanMark({
      user: request.user!,
      reportId: id,
      plan_id: body.plan_id,
      page: body.page,
      x_norm: body.x_norm,
      y_norm: body.y_norm,
    });
  });

  app.delete('/:id/plan-mark', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    return clearPlanMark({ user: request.user!, reportId: id });
  });
}
