import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';

/**
 * Список project_id, доступных пользователю.
 * Для admin возвращает null — это «все проекты», в WHERE подставляется через
 * `($1::uuid[] IS NULL OR project_id = ANY($1::uuid[]))`.
 */
export async function getUserProjectIds(
  user: AuthenticatedUser,
): Promise<string[] | null> {
  if (user.role === 'admin') return null;
  const result = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM project_memberships WHERE user_id = $1`,
    [user.id],
  );
  return result.rows.map((r) => r.project_id);
}

export async function isProjectMember(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const result = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_memberships
       WHERE user_id = $1 AND project_id = $2
     ) AS ok`,
    [userId, projectId],
  );
  return result.rows[0]?.ok === true;
}

export async function assertProjectMember(
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  if (user.role === 'admin') return;
  if (!user.isActive) {
    throw new AppError(
      403,
      'INACTIVE_USER',
      'Аккаунт ожидает активации администратором.',
    );
  }
  const ok = await isProjectMember(user.id, projectId);
  if (!ok) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к проекту.');
  }
}

export async function assertProjectExists(projectId: string): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1`,
    [projectId],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Проект не найден.');
  }
}
