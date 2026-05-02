import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import { parseBody, parseQuery, uuidSchema } from '../http/validate.js';
import {
  listActiveDict,
  upsertDictPublic,
} from '../services/catalogsService.js';

const querySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});

const createSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
});

export default async function workAssignmentsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/', guard, async (request) => {
    const q = parseQuery(querySchema, request.query);
    if (q.active === 'false') {
      return { workAssignments: [] };
    }
    return { workAssignments: await listActiveDict('work_assignments') };
  });

  app.post('/', guard, async (request) => {
    const body = parseBody(createSchema, request.body);
    const item = await upsertDictPublic({
      kind: 'work_assignments',
      id: body.id ?? null,
      name: body.name,
      createdBy: request.user!.id,
    });
    return { workAssignment: item };
  });
}
