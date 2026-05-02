import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import { parseQuery } from '../http/validate.js';
import { listActivePerformers } from '../services/catalogsService.js';

const querySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});

export default async function performersRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/', guard, async (request) => {
    const q = parseQuery(querySchema, request.query);
    if (q.active === 'false') {
      return { performers: [] };
    }
    return { performers: await listActivePerformers() };
  });
}
