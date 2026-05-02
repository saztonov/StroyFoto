import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import { parseBody, uuidSchema } from '../http/validate.js';
import { presign } from '../services/presignService.js';

const bodySchema = z.object({
  op: z.enum(['put', 'get', 'delete']),
  kind: z.enum(['photo', 'photo_thumb', 'plan']),
  key: z.string().min(1).max(256),
  reportId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  planId: uuidSchema.optional(),
  contentType: z.string().min(1).max(100).optional(),
});

export default async function presignRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/',
    { preHandler: [authenticate, requireActiveUser] },
    async (request) => {
      const body = parseBody(bodySchema, request.body);
      return presign({
        op: body.op,
        kind: body.kind,
        key: body.key,
        reportId: body.reportId,
        projectId: body.projectId,
        planId: body.planId,
        contentType: body.contentType,
        user: request.user!,
      });
    },
  );
}
