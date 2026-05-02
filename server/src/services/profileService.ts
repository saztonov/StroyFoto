import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import {
  buildSessionResponse,
  type ProfileDTO,
  type SessionEnvelope,
} from '../http/responses.js';
import type { UserRole } from '../auth/jwt.js';

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

export interface ProfileQueryInput {
  userId: string;
  email: string;
  accessToken: string;
  expiresAtSec: number;
}

export async function getProfile(
  input: ProfileQueryInput,
): Promise<SessionEnvelope> {
  const result = await pool.query<ProfileRow>(
    `SELECT id, full_name, role, is_active
     FROM profiles
     WHERE id = $1`,
    [input.userId],
  );
  if (result.rowCount === 0) {
    throw new AppError(500, 'PROFILE_MISSING', 'Профиль пользователя отсутствует.');
  }
  const profile = profileFromRow(result.rows[0]);

  return buildSessionResponse({
    user: { id: input.userId, email: input.email },
    profile,
    accessToken: input.accessToken,
    expiresAtSec: input.expiresAtSec,
  });
}

export interface UpdateProfileInput extends ProfileQueryInput {
  fullName: string;
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<SessionEnvelope> {
  const fullName = input.fullName.trim();
  const result = await pool.query<ProfileRow>(
    `UPDATE profiles
     SET full_name = $1
     WHERE id = $2
     RETURNING id, full_name, role, is_active`,
    [fullName, input.userId],
  );
  if (result.rowCount === 0) {
    throw new AppError(500, 'PROFILE_MISSING', 'Профиль пользователя отсутствует.');
  }
  const profile = profileFromRow(result.rows[0]);

  return buildSessionResponse({
    user: { id: input.userId, email: input.email },
    profile,
    accessToken: input.accessToken,
    expiresAtSec: input.expiresAtSec,
  });
}
