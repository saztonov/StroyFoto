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

const csvUuidListSchema = z
  .string()
  .min(1)
  .transform((s, ctx) => {
    const parts = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length === 0) return [] as string[];
    if (parts.length > 200) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Не более 200 идентификаторов в одном запросе.',
      });
      return z.NEVER;
    }
    const validated = z.array(uuidSchema).safeParse(parts);
    if (!validated.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Список идентификаторов содержит некорректные значения.',
      });
      return z.NEVER;
    }
    return validated.data;
  });

const csvMonthListSchema = z
  .string()
  .min(1)
  .transform((s, ctx) => {
    const parts = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length === 0) return [] as string[];
    if (parts.length > 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Не более 24 месяцев в одном запросе.',
      });
      return z.NEVER;
    }
    if (parts.some((p) => !/^\d{4}-\d{2}$/.test(p))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Месяц ожидается в формате YYYY-MM.',
      });
      return z.NEVER;
    }
    return parts;
  });

const truthyBoolSchema = z
  .string()
  .transform((s) => s === 'true' || s === '1');

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  project_id: uuidSchema.optional(),
  work_type_ids: csvUuidListSchema.optional(),
  months: csvMonthListSchema.optional(),
  date_from: isoDateSchema.optional(),
  date_to: isoDateSchema.optional(),
  include_photos: truthyBoolSchema.optional(),
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
      limit: q.limit ?? 50,
      projectId: q.project_id ?? null,
      workTypeIds: q.work_type_ids ?? null,
      months: q.months ?? null,
      dateFrom: q.date_from ?? null,
      dateTo: q.date_to ?? null,
      includePhotos: q.include_photos === true,
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
