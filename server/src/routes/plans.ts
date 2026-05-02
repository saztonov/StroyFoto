import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import {
  idParamsSchema,
  parseBody,
  parseParams,
  uuidSchema,
} from '../http/validate.js';
import {
  createPlan,
  deletePlan,
  listPlansForProject,
  listPlansForUser,
  updatePlan,
} from '../services/plansService.js';

const createSchema = z.object({
  id: uuidSchema.optional(),
  project_id: uuidSchema,
  name: z.string().trim().min(1).max(300),
  floor: z.string().trim().max(100).nullable().optional(),
  building: z.string().trim().max(200).nullable().optional(),
  section: z.string().trim().max(200).nullable().optional(),
  object_key: z.string().min(1).max(500),
  page_count: z.number().int().positive().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  floor: z.string().trim().max(100).nullable().optional(),
  building: z.string().trim().max(200).nullable().optional(),
  section: z.string().trim().max(200).nullable().optional(),
  page_count: z.number().int().positive().nullable().optional(),
});

const projectParamsSchema = z.object({ projectId: uuidSchema });

export default async function plansRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/plans', guard, async (request) => ({
    plans: await listPlansForUser(request.user!),
  }));

  app.get(
    '/projects/:projectId/plans',
    guard,
    async (request) => {
      const { projectId } = parseParams(projectParamsSchema, request.params);
      return {
        plans: await listPlansForProject(request.user!, projectId),
      };
    },
  );

  app.post('/plans', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    const plan = await createPlan({
      user: request.user!,
      id: body.id ?? null,
      project_id: body.project_id,
      name: body.name,
      floor: body.floor ?? null,
      building: body.building ?? null,
      section: body.section ?? null,
      object_key: body.object_key,
      page_count: body.page_count ?? null,
    });
    return { plan };
  });

  app.patch('/plans/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(updateSchema, request.body);
    const plan = await updatePlan({
      user: request.user!,
      id,
      name: body.name,
      floor: body.floor,
      building: body.building,
      section: body.section,
      page_count: body.page_count,
    });
    return { plan };
  });

  app.delete('/plans/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    await deletePlan({ user: request.user!, id });
    return { ok: true };
  });
}
