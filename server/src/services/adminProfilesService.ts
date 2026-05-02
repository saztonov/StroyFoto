import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { UserRole } from '../auth/jwt.js';

export interface AdminProfileDTO {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AdminProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDTO(row: AdminProfileRow): AdminProfileDTO {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listAdminProfiles(): Promise<AdminProfileDTO[]> {
  const result = await pool.query<AdminProfileRow>(
    `SELECT p.id, p.full_name, au.email::text AS email,
            p.role, p.is_active, p.created_at, p.updated_at
       FROM profiles p
       JOIN app_users au ON au.id = p.id
      WHERE au.deleted_at IS NULL
      ORDER BY p.created_at DESC`,
  );
  return result.rows.map(toDTO);
}

async function fetchAdminProfile(id: string): Promise<AdminProfileDTO> {
  const result = await pool.query<AdminProfileRow>(
    `SELECT p.id, p.full_name, au.email::text AS email,
            p.role, p.is_active, p.created_at, p.updated_at
       FROM profiles p
       JOIN app_users au ON au.id = p.id
      WHERE p.id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }
  return toDTO(result.rows[0]);
}

export async function setProfileFullName(
  id: string,
  fullName: string | null,
): Promise<AdminProfileDTO> {
  const value = fullName?.trim() || null;
  const result = await pool.query<{ id: string }>(
    `UPDATE profiles SET full_name = $1 WHERE id = $2 RETURNING id`,
    [value, id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }
  return fetchAdminProfile(id);
}

export async function setProfileActive(
  id: string,
  isActive: boolean,
): Promise<AdminProfileDTO> {
  const result = await pool.query<{ id: string }>(
    `UPDATE profiles SET is_active = $1 WHERE id = $2 RETURNING id`,
    [isActive, id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }
  return fetchAdminProfile(id);
}

export async function setProfileRole(
  id: string,
  role: UserRole,
): Promise<AdminProfileDTO> {
  const result = await pool.query<{ id: string }>(
    `UPDATE profiles SET role = $1::user_role WHERE id = $2 RETURNING id`,
    [role, id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }
  return fetchAdminProfile(id);
}
