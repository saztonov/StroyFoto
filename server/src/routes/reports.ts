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
  setPhotoPlanMarks,
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
  performer_ids: csvUuidListSchema.optional(),
  months: csvMonthListSchema.optional(),
  date_from: isoDateSchema.optional(),
  date_to: isoDateSchema.optional(),
  include_photos: truthyBoolSchema.optional(),
});

// Набор подрядчиков отчёта. Верхняя граница та же, что у csvUuidListSchema.
// Дубли не отвергаются, а схлопываются в сервисе: отказ превратил бы
// sync-операцию в вечно падающую и заблокировал бы черновик на устройстве.
const performerIdsSchema = z.array(uuidSchema).min(1).max(200);

/**
 * Основной исполнитель обязан быть первым элементом набора — иначе на сервере
 * появились бы два несогласованных источника истины. Если прислан только набор,
 * основной выводится из performer_ids[0].
 */
function assertPerformersConsistent(
  v: { performer_id?: string; performer_ids?: string[] },
  ctx: z.RefinementCtx,
): void {
  if (
    v.performer_id !== undefined &&
    v.performer_ids !== undefined &&
    v.performer_ids[0] !== v.performer_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['performer_ids'],
      message:
        'performer_id должен совпадать с первым элементом performer_ids.',
    });
  }
}

const createSchema = z
  .object({
    id: uuidSchema,
    project_id: uuidSchema,
    work_type_id: uuidSchema,
    // Необязателен, если прислан performer_ids: старые клиенты шлют только его,
    // новые могут прислать только набор.
    performer_id: uuidSchema.optional(),
    performer_ids: performerIdsSchema.optional(),
    work_assignment_id: uuidSchema.nullable().optional(),
    plan_id: uuidSchema.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    taken_at: isoDateSchema.nullable().optional(),
    author_id: uuidSchema.optional(),
  })
  .superRefine((v, ctx) => {
    assertPerformersConsistent(v, ctx);
    if (v.performer_id === undefined && v.performer_ids === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['performer_id'],
        message: 'Нужно указать performer_id или performer_ids.',
      });
    }
  });

const updateSchema = z
  .object({
    expectedUpdatedAt: isoDateSchema.nullable().optional(),
    work_type_id: uuidSchema.optional(),
    performer_id: uuidSchema.optional(),
    performer_ids: performerIdsSchema.optional(),
    work_assignment_id: uuidSchema.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    taken_at: isoDateSchema.nullable().optional(),
    plan_id: uuidSchema.nullable().optional(),
  })
  .superRefine(assertPerformersConsistent);

const planMarkSchema = z.object({
  plan_id: uuidSchema,
  page: z.number().int().positive(),
  x_norm: z.number().min(0).max(1),
  y_norm: z.number().min(0).max(1),
});

const photoPlanMarksSchema = z.object({
  // Пустой массив разрешён намеренно: это явное удаление всех точек, а не
  // «нечего делать». Дубли по photo_id схлопывает сервис, а не отвергает —
  // отказ превратил бы sync-операцию в вечно падающую.
  marks: z.array(planMarkSchema.extend({ photo_id: uuidSchema })).max(200),
  // bigint приходит строкой, чтобы не терять точность на JS-числе.
  // null/отсутствие — «не проверять версию» (первая отправка с устройства).
  expectedMarksVersion: z
    .string()
    .regex(/^\d+$/, 'Версия должна быть целым числом.')
    .nullable()
    .optional(),
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
      performerIds: q.performer_ids ?? null,
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
    // Схема гарантирует, что хотя бы одно из полей задано и что они согласованы.
    const performerIds = body.performer_ids ?? [body.performer_id!];
    const report = await createReport({
      user: request.user!,
      id: body.id,
      project_id: body.project_id,
      work_type_id: body.work_type_id,
      performer_id: performerIds[0],
      performer_ids: performerIds,
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
      performer_ids: body.performer_ids,
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

  // Полная замена набора точек фотографий. Отдельный роут, а не расширение
  // /plan-mark: старые клиенты продолжают работать с легаси-меткой, а откат
  // API не делает новые точки недоступными.
  app.put('/:id/photo-plan-marks', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(photoPlanMarksSchema, request.body);
    return setPhotoPlanMarks({
      user: request.user!,
      reportId: id,
      marks: body.marks,
      expectedMarksVersion: body.expectedMarksVersion ?? null,
    });
  });
}
