import type { FastifyInstance } from 'fastify';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import { listProjectsForUser } from '../services/projectsService.js';

export default async function projectsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/',
    { preHandler: [authenticate, requireActiveUser] },
    async (request) => ({
      projects: await listProjectsForUser(request.user!),
    }),
  );
}
