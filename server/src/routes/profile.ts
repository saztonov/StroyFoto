import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { getProfile, updateProfile } from '../services/profileService.js';
import { changePassword } from '../services/passwordService.js';
import { parseBody } from '../http/validate.js';

const patchSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
});

// Границы длины проверяет validateNewPassword в сервисе — здесь только грубый
// потолок, чтобы не гонять bcrypt по огромному телу.
const passwordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(1).max(200),
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

  // Лимит жёстче глобального: endpoint — CPU-сток на bcrypt и заодно оракул
  // пароля для того, кто завладел чужим access-токеном.
  // requireActiveUser намеренно НЕ ставим: пользователь, ожидающий активации,
  // тоже должен уметь сменить пароль (как и в остальных роутах этого файла).
  app.post(
    '/password',
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request) => {
      const body = parseBody(passwordSchema, request.body);
      const u = request.user!;
      const ua = request.headers['user-agent'];
      return changePassword(
        {
          userId: u.id,
          currentPassword: body.current_password,
          newPassword: body.new_password,
        },
        {
          userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null,
          ip: request.ip ?? null,
        },
      );
    },
  );

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
