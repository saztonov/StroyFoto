import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams } from '../http/validate.js';
import {
  createPerformer,
  listAllPerformers,
  setPerformerActive,
  updatePerformer,
} from '../services/catalogsService.js';

const kindSchema = z.enum(['contractor', 'own_forces']);

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: kindSchema,
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    kind: kindSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.kind !== undefined,
    'Должно быть указано хотя бы одно поле для изменения.',
  );

const activeSchema = z.object({ is_active: z.boolean() });

export default async function adminPerformersRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/', guard, async () => ({
    performers: await listAllPerformers(),
  }));

  app.post('/', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    const item = await createPerformer({ name: body.name, kind: body.kind });
    return { performer: item };
  });

  app.patch('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(updateSchema, request.body);
    const item = await updatePerformer({
      id,
      name: body.name,
      kind: body.kind,
    });
    return { performer: item };
  });

  app.patch('/:id/active', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(activeSchema, request.body);
    const item = await setPerformerActive({ id, isActive: body.is_active });
    return { performer: item };
  });
}
