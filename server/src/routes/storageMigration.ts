import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams, parseQuery } from '../http/validate.js';
import {
  getOverview,
  listPhotosByStorage,
  listPlansByStorage,
  markPhotoStorage,
  markPlanStorage,
} from '../services/storageMigrationService.js';

const listQuerySchema = z.object({
  storage: z.enum(['cloudru', 'r2']).default('r2'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const patchSchema = z.object({
  storage: z.enum(['cloudru', 'r2']),
  expected_storage: z.enum(['cloudru', 'r2']).default('r2'),
});

export default async function storageMigrationRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/overview', guard, async () => ({
    overview: await getOverview(),
  }));

  app.get('/photos', guard, async (request) => {
    const q = parseQuery(listQuerySchema, request.query);
    return {
      items: await listPhotosByStorage({
        storage: q.storage,
        limit: q.limit,
      }),
    };
  });

  app.get('/plans', guard, async (request) => {
    const q = parseQuery(listQuerySchema, request.query);
    return {
      items: await listPlansByStorage({
        storage: q.storage,
        limit: q.limit,
      }),
    };
  });

  app.patch('/report-photos/:id/storage', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(patchSchema, request.body);
    return markPhotoStorage({
      id,
      storage: body.storage,
      expectedStorage: body.expected_storage,
    });
  });

  app.patch('/plans/:id/storage', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(patchSchema, request.body);
    return markPlanStorage({
      id,
      storage: body.storage,
      expectedStorage: body.expected_storage,
    });
  });
}
