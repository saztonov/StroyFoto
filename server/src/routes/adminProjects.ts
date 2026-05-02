import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams } from '../http/validate.js';
import {
  createProject,
  deleteProject,
  listAllProjects,
  updateProject,
} from '../services/projectsService.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.description !== undefined,
    'Должно быть указано хотя бы одно поле для изменения.',
  );

export default async function adminProjectsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/', guard, async () => ({ projects: await listAllProjects() }));

  app.post('/', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    return {
      project: await createProject({
        name: body.name,
        description: body.description ?? null,
        createdBy: request.user!.id,
      }),
    };
  });

  app.patch('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(updateSchema, request.body);
    return {
      project: await updateProject({
        id,
        name: body.name,
        description: body.description,
      }),
    };
  });

  app.delete('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    await deleteProject(id);
    return { ok: true };
  });
}
