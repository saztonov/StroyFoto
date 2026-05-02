import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';

export async function listUserProjects(userId: string): Promise<string[]> {
  const profile = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE id = $1`,
    [userId],
  );
  if (profile.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }
  const result = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM project_memberships WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map((r) => r.project_id);
}

export async function setUserProjects(
  userId: string,
  projectIds: string[],
): Promise<{ projectIds: string[] }> {
  const profile = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE id = $1`,
    [userId],
  );
  if (profile.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Профиль не найден.');
  }

  const unique = Array.from(new Set(projectIds));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO project_memberships (project_id, user_id)
         SELECT pid, $1 FROM unnest($2::uuid[]) AS pid
         ON CONFLICT DO NOTHING`,
        [userId, unique],
      );
      await client.query(
        `DELETE FROM project_memberships
          WHERE user_id = $1 AND project_id <> ALL($2::uuid[])`,
        [userId, unique],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      mapPgError(err, {
        foreignKeyViolation: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Один из проектов не найден.',
        },
      });
    }
  } finally {
    client.release();
  }

  return { projectIds: unique };
}
