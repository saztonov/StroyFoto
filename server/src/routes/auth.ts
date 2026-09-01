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
import {
  checkResetToken,
  confirmPasswordReset,
  requestPasswordReset,
} from '../services/passwordResetService.js';

const registerSchema = z.object({
  email: z.string().email('Введите корректный email').max(320),
  // Минимум и границу в 72 байта проверяет validateNewPassword в сервисе:
  // локальный parseBody ниже схлопывает ошибки схемы в VALIDATION_ERROR, и
  // отдельный код WEAK_PASSWORD до клиента бы не дошёл. Здесь только грубый
  // потолок, чтобы не гонять bcrypt по мегабайтному телу.
  password: z.string().min(1).max(200),
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

const resetRequestSchema = z.object({
  email: z.string().email().max(320),
});

const resetTokenSchema = z.object({
  token: z.string().min(1).max(512),
});

const resetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  // Границы длины проверяет validateNewPassword — см. passwordPolicy.ts.
  password: z.string().min(1).max(200),
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

  // Лимит жёстче, чем на login: именно per-IP ограничение останавливает
  // перебор адресов через форму «Забыли пароль?».
  const resetRequestLimit = {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  } as const;

  // ВСЕГДА 202 и один и тот же ответ: существует адрес или нет, активен
  // профиль или ждёт активации. Иначе форма превращается в проверялку
  // зарегистрированных адресов.
  app.post('/password-reset/request', resetRequestLimit, async (request, reply) => {
    const body = parseBody(resetRequestSchema, request.body);
    await requestPasswordReset(body.email, ctxFromRequest(request));
    return reply.code(202).send({ ok: true });
  });

  // POST, а не GET: токен не попадает во вторую строку access-лога nginx, и
  // ссылку не может «нажать» превью мессенджера или сканер антивируса.
  // Обработчик ничего не мутирует и токен не расходует.
  app.post('/password-reset/check', sensitiveAuthLimit, async (request) => {
    const body = parseBody(resetTokenSchema, request.body);
    return checkResetToken(body.token);
  });

  app.post('/password-reset/confirm', sensitiveAuthLimit, async (request) => {
    const body = parseBody(resetConfirmSchema, request.body);
    return confirmPasswordReset(
      body.token,
      body.password,
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
