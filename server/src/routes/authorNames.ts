import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import { parseBody, parseQuery, parseUuidList, uuidSchema } from '../http/validate.js';
import { resolveAuthorNames } from '../services/authorNamesService.js';

const querySchema = z.object({
  ids: z.string().min(1),
});

const bodySchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
});

export default async function authorNamesRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/', guard, async (request) => {
    const q = parseQuery(querySchema, request.query);
    const ids = parseUuidList(q.ids, 200);
    const names = await resolveAuthorNames(request.user!, ids);
    return { names };
  });

  app.post('/', guard, async (request) => {
    const body = parseBody(bodySchema, request.body);
    const names = await resolveAuthorNames(request.user!, body.ids);
    return { names };
  });
}
