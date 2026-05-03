import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import {
  getMe,
  login,
  logout,
  refresh,
  register,
} from '../services/authService.js';

const registerSchema = z.object({
  email: z.string().email('Введите корректный email').max(320),
  password: z.string().min(6, 'Пароль должен быть не короче 6 символов').max(200),
  fullName: z.string().trim().min(1).max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1).max(512),
});

const logoutSchema = z.object({
  refresh_token: z.string().min(1).max(512),
});

function ctxFromRequest(request: FastifyRequest): {
  userAgent: string | null;
  ip: string | null;
} {
  const ua = request.headers['user-agent'];
  const userAgent = typeof ua === 'string' ? ua.slice(0, 500) : null;
  const ip = request.ip ?? null;
  return { userAgent, ip };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Проверьте введённые данные.',
    );
  }
  return parsed.data;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Жёсткий лимит на login/register: защита от brute-force и spam-регистраций.
  // 10 попыток в минуту с одного IP — для нормального пользователя более чем
  // достаточно, для атакующего с одного IP — заметно дольше.
  const sensitiveAuthLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  } as const;

  app.post('/register', sensitiveAuthLimit, async (request) => {
    const body = parseBody(registerSchema, request.body);
    return register(
      {
        email: body.email,
        password: body.password,
        fullName: body.fullName ?? null,
      },
      ctxFromRequest(request),
    );
  });

  app.post('/login', sensitiveAuthLimit, async (request) => {
    const body = parseBody(loginSchema, request.body);
    return login(
      { email: body.email, password: body.password },
      ctxFromRequest(request),
    );
  });

  app.post('/refresh', async (request) => {
    const body = parseBody(refreshSchema, request.body);
    return refresh({ rawToken: body.refresh_token }, ctxFromRequest(request));
  });

  app.post(
    '/logout',
    { preHandler: authenticate },
    async (request) => {
      const body = parseBody(logoutSchema, request.body);
      return logout(request.user!.id, body.refresh_token);
    },
  );

  app.get(
    '/me',
    { preHandler: authenticate },
    async (request) => {
      const u = request.user!;
      return getMe({
        userId: u.id,
        email: u.email,
        accessToken: u.accessToken,
        expiresAtSec: u.accessExpSec,
      });
    },
  );
}
