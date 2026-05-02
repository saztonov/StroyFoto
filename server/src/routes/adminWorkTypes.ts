import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams } from '../http/validate.js';
import {
  createDictAdmin,
  listAllDict,
  renameDictAdmin,
  setDictActiveAdmin,
} from '../services/catalogsService.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const renameSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const activeSchema = z.object({ is_active: z.boolean() });

export default async function adminWorkTypesRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/', guard, async () => ({
    workTypes: await listAllDict('work_types'),
  }));

  app.post('/', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    const item = await createDictAdmin({
      kind: 'work_types',
      name: body.name,
      createdBy: request.user!.id,
    });
    return { workType: item };
  });

  app.patch('/:id', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(renameSchema, request.body);
    const item = await renameDictAdmin({
      kind: 'work_types',
      id,
      name: body.name,
    });
    return { workType: item };
  });

  app.patch('/:id/active', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(activeSchema, request.body);
    const item = await setDictActiveAdmin({
      kind: 'work_types',
      id,
      isActive: body.is_active,
    });
    return { workType: item };
  });
}
