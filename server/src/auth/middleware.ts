import type { preHandlerHookHandler } from 'fastify';
import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { verifyAccessToken, type UserRole } from './jwt.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  accessToken: string;
  accessExpSec: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT au.id, au.email::text AS email, p.role, p.is_active
     FROM app_users au
     JOIN profiles p ON p.id = au.id
     WHERE au.id = $1 AND au.deleted_at IS NULL`,
    [userId],
  );
  return result.rowCount === 0 ? null : result.rows[0];
}

export const authenticate: preHandlerHookHandler = async (request) => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }

  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }

  const row = await loadUser(payload.sub);
  if (!row) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }

  request.user = {
    id: row.id,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    accessToken: token,
    accessExpSec: payload.exp,
  };
};

export const requireActiveUser: preHandlerHookHandler = async (request) => {
  if (!request.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }
  if (!request.user.isActive) {
    throw new AppError(
      403,
      'INACTIVE_USER',
      'Аккаунт ожидает активации администратором.',
    );
  }
};

export const requireAdmin: preHandlerHookHandler = async (request) => {
  if (!request.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }
  if (request.user.role !== 'admin' || !request.user.isActive) {
    throw new AppError(403, 'FORBIDDEN', 'Недостаточно прав.');
  }
};
