import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams, uuidSchema } from '../http/validate.js';
import {
  cancelResetRequest,
  issueResetLink,
  listResetRequests,
} from '../services/passwordResetService.js';

const issueSchema = z.object({ user_id: uuidSchema });

export default async function adminPasswordResetsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/', guard, async () => ({
    requests: await listResetRequests(),
  }));

  // Сырой токен возвращается ЕДИНСТВЕННЫЙ раз и больше нигде не хранится:
  // в БД лежит только sha256. Ссылку из него собирает клиент.
  app.post('/', guard, async (request) => {
    const body = parseBody(issueSchema, request.body);
    return issueResetLink(body.user_id, request.user!.id);
  });

  app.post('/:id/cancel', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    return { request: await cancelResetRequest(id, request.user!.id) };
  });
}
