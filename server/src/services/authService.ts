import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import {
  buildSessionResponse,
  type ProfileDTO,
  type SessionEnvelope,
} from '../http/responses.js';
import { signAccessToken, type UserRole } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  issueRefreshToken,
  lookupRefreshToken,
  markExpired,
  revokeFamily,
  revokeRefreshToken,
  rotateRefreshToken,
  type IssueContext,
} from '../auth/refreshTokens.js';

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshInput {
  rawToken: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  deleted_at: Date | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

function profileFromRow(row: ProfileRow): ProfileDTO {
  return {
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
  };
}

async function buildEnvelopeWithTokens(
  user: { id: string; email: string },
  profile: ProfileDTO,
  ctx: IssueContext,
  withRefresh: boolean,
): Promise<SessionEnvelope> {
  const access = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: profile.role,
    isActive: profile.is_active,
  });
  let refreshToken: string | undefined;
  if (withRefresh) {
    const issued = await issueRefreshToken(user.id, ctx);
    refreshToken = issued.rawToken;
  }
  return buildSessionResponse({
    user,
    profile,
    accessToken: access.token,
    refreshToken,
    expiresAtSec: access.expiresAtSec,
  });
}

export async function register(
  input: RegisterInput,
  ctx: IssueContext = {},
): Promise<SessionEnvelope> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName?.trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM app_users WHERE email = $1',
      [email],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query('ROLLBACK');
      throw new AppError(
        409,
        'USER_EXISTS',
        'Пользователь с такой электронной почтой уже зарегистрирован.',
      );
    }

    const passwordHash = await hashPassword(input.password);

    const userInsert = await client.query<{ id: string; email: string }>(
      `INSERT INTO app_users (email, password_hash, last_login_at)
       VALUES ($1, $2, now())
       RETURNING id, email::text AS email`,
      [email, passwordHash],
    );
    const user = userInsert.rows[0];

    const profileInsert = await client.query<ProfileRow>(
      `INSERT INTO profiles (id, full_name, role, is_active)
       VALUES ($1, $2, 'user', false)
       RETURNING id, full_name, role, is_active`,
      [user.id, fullName],
    );
    const profile = profileFromRow(profileInsert.rows[0]);

    await client.query('COMMIT');

    return buildEnvelopeWithTokens(user, profile, ctx, true);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors after commit
    }
    throw err;
  } finally {
    client.release();
  }
}

const INVALID_CREDENTIALS = new AppError(
  401,
  'INVALID_CREDENTIALS',
  'Неверная электронная почта или пароль.',
);

export async function login(
  input: LoginInput,
  ctx: IssueContext = {},
): Promise<SessionEnvelope> {
  const email = input.email.trim().toLowerCase();

  const userResult = await pool.query<UserRow>(
    `SELECT id, email::text AS email, password_hash, deleted_at
     FROM app_users
     WHERE email = $1`,
    [email],
  );
  if (userResult.rowCount === 0) {
    throw INVALID_CREDENTIALS;
  }
  const user = userResult.rows[0];
  if (user.deleted_at !== null || user.password_hash === null) {
    throw INVALID_CREDENTIALS;
  }

  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) {
    throw INVALID_CREDENTIALS;
  }

  const profileResult = await pool.query<ProfileRow>(
    `SELECT id, full_name, role, is_active
     FROM profiles
     WHERE id = $1`,
    [user.id],
  );
  if (profileResult.rowCount === 0) {
    throw new AppError(500, 'PROFILE_MISSING', 'Профиль пользователя отсутствует.');
  }
  const profile = profileFromRow(profileResult.rows[0]);

  await pool.query('UPDATE app_users SET last_login_at = now() WHERE id = $1', [
    user.id,
  ]);

  return buildEnvelopeWithTokens(
    { id: user.id, email: user.email },
    profile,
    ctx,
    true,
  );
}

export async function refresh(
  input: RefreshInput,
  ctx: IssueContext = {},
): Promise<SessionEnvelope> {
  const lookup = await lookupRefreshToken(input.rawToken);
  if (!lookup) {
    throw new AppError(
      401,
      'INVALID_REFRESH',
      'Сессия недействительна. Войдите заново.',
    );
  }

  if (lookup.expiresAt.getTime() <= Date.now()) {
    await markExpired(lookup.id);
    throw new AppError(
      401,
      'REFRESH_EXPIRED',
      'Сессия истекла. Войдите заново.',
    );
  }

  if (lookup.revokedAt !== null) {
    await revokeFamily(lookup.id);
    throw new AppError(
      401,
      'INVALID_REFRESH',
      'Сессия недействительна. Войдите заново.',
    );
  }

  const userResult = await pool.query<UserRow>(
    `SELECT id, email::text AS email, password_hash, deleted_at
     FROM app_users
     WHERE id = $1`,
    [lookup.userId],
  );
  if (userResult.rowCount === 0 || userResult.rows[0].deleted_at !== null) {
    throw new AppError(
      401,
      'INVALID_REFRESH',
      'Сессия недействительна. Войдите заново.',
    );
  }
  const user = userResult.rows[0];

  const profileResult = await pool.query<ProfileRow>(
    `SELECT id, full_name, role, is_active
     FROM profiles
     WHERE id = $1`,
    [user.id],
  );
  if (profileResult.rowCount === 0) {
    throw new AppError(500, 'PROFILE_MISSING', 'Профиль пользователя отсутствует.');
  }
  const profile = profileFromRow(profileResult.rows[0]);

  const rotation = await rotateRefreshToken(lookup.id, user.id, ctx);

  const access = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: profile.role,
    isActive: profile.is_active,
  });

  return buildSessionResponse({
    user: { id: user.id, email: user.email },
    profile,
    accessToken: access.token,
    refreshToken: rotation.newToken.rawToken,
    expiresAtSec: access.expiresAtSec,
  });
}

export async function logout(
  userId: string,
  rawToken: string | null,
): Promise<{ ok: true }> {
  if (rawToken) {
    await revokeRefreshToken(rawToken, userId);
  }
  return { ok: true };
}

export interface MeInput {
  userId: string;
  email: string;
  accessToken: string;
  expiresAtSec: number;
}

export async function getMe(input: MeInput): Promise<SessionEnvelope> {
  const profileResult = await pool.query<ProfileRow>(
    `SELECT id, full_name, role, is_active
     FROM profiles
     WHERE id = $1`,
    [input.userId],
  );
  if (profileResult.rowCount === 0) {
    throw new AppError(500, 'PROFILE_MISSING', 'Профиль пользователя отсутствует.');
  }
  const profile = profileFromRow(profileResult.rows[0]);

  return buildSessionResponse({
    user: { id: input.userId, email: input.email },
    profile,
    accessToken: input.accessToken,
    expiresAtSec: input.expiresAtSec,
  });
}
