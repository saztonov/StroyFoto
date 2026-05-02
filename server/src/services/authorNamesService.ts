import { pool } from '../db.js';
import type { AuthenticatedUser } from '../auth/middleware.js';

export interface AuthorNameDTO {
  author_id: string;
  full_name: string | null;
}

interface Row {
  author_id: string;
  full_name: string | null;
}

export async function resolveAuthorNames(
  user: AuthenticatedUser,
  ids: string[],
): Promise<AuthorNameDTO[]> {
  if (ids.length === 0) return [];
  const result = await pool.query<Row>(
    `SELECT p.id AS author_id, p.full_name
       FROM profiles p
      WHERE p.id = ANY($1::uuid[])
        AND ($2::boolean OR EXISTS (
              SELECT 1
                FROM reports r
                JOIN project_memberships m
                  ON m.project_id = r.project_id AND m.user_id = $3
               WHERE r.author_id = p.id
            ))`,
    [ids, user.role === 'admin', user.id],
  );
  return result.rows;
}
