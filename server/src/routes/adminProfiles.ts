import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/middleware.js';
import { idParamsSchema, parseBody, parseParams, uuidSchema } from '../http/validate.js';
import {
  listAdminProfiles,
  setProfileActive,
  setProfileFullName,
  setProfileRole,
} from '../services/adminProfilesService.js';
import {
  listUserProjects,
  setUserProjects,
} from '../services/membershipsService.js';

const fullNameSchema = z.object({
  full_name: z.string().trim().min(1).max(200).nullable(),
});

const activeSchema = z.object({ is_active: z.boolean() });

const roleSchema = z.object({ role: z.enum(['admin', 'user']) });

const userIdParams = z.object({ userId: uuidSchema });

const setProjectsSchema = z.object({
  projectIds: z.array(uuidSchema).max(500),
});

export default async function adminProfilesRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireAdmin] };

  app.get('/', guard, async () => ({
    profiles: await listAdminProfiles(),
  }));

  app.patch('/:id/full-name', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(fullNameSchema, request.body);
    return { profile: await setProfileFullName(id, body.full_name) };
  });

  app.patch('/:id/active', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(activeSchema, request.body);
    return { profile: await setProfileActive(id, body.is_active) };
  });

  app.patch('/:id/role', guard, async (request) => {
    const { id } = parseParams(idParamsSchema, request.params);
    const body = parseBody(roleSchema, request.body);
    return { profile: await setProfileRole(id, body.role) };
  });

  app.get('/:userId/projects', guard, async (request) => {
    const { userId } = parseParams(userIdParams, request.params);
    return { projectIds: await listUserProjects(userId) };
  });

  app.put('/:userId/projects', guard, async (request) => {
    const { userId } = parseParams(userIdParams, request.params);
    const body = parseBody(setProjectsSchema, request.body);
    return setUserProjects(userId, body.projectIds);
  });
}
