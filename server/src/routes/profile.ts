import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { getProfile, updateProfile } from '../services/profileService.js';

const patchSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
});

export default async function profileRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const u = request.user!;
    return getProfile({
      userId: u.id,
      email: u.email,
      accessToken: u.accessToken,
      expiresAtSec: u.accessExpSec,
    });
  });

  app.patch('/', { preHandler: authenticate }, async (request) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Проверьте введённые данные.',
      );
    }
    const u = request.user!;
    return updateProfile({
      userId: u.id,
      email: u.email,
      accessToken: u.accessToken,
      expiresAtSec: u.accessExpSec,
      fullName: parsed.data.full_name,
    });
  });
}
