import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDTO(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listProjectsForUser(
  user: AuthenticatedUser,
): Promise<ProjectDTO[]> {
  if (user.role === 'admin') {
    const result = await pool.query<ProjectRow>(
      `SELECT id, name, description, created_by, created_at, updated_at
         FROM projects
         ORDER BY name ASC
         LIMIT 1000`,
    );
    return result.rows.map(toDTO);
  }
  const result = await pool.query<ProjectRow>(
    `SELECT p.id, p.name, p.description, p.created_by, p.created_at, p.updated_at
       FROM projects p
       JOIN project_memberships m ON m.project_id = p.id AND m.user_id = $1
       ORDER BY p.name ASC
       LIMIT 1000`,
    [user.id],
  );
  return result.rows.map(toDTO);
}

export async function listAllProjects(): Promise<ProjectDTO[]> {
  const result = await pool.query<ProjectRow>(
    `SELECT id, name, description, created_by, created_at, updated_at
       FROM projects
       ORDER BY name ASC
       LIMIT 1000`,
  );
  return result.rows.map(toDTO);
}

export async function createProject(input: {
  name: string;
  description: string | null;
  createdBy: string;
}): Promise<ProjectDTO> {
  try {
    const result = await pool.query<ProjectRow>(
      `INSERT INTO projects (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by, created_at, updated_at`,
      [input.name.trim(), input.description?.trim() || null, input.createdBy],
    );
    return toDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'PROJECT_NAME_TAKEN',
        message: 'Проект с таким названием уже существует.',
      },
    });
  }
}

export async function updateProject(input: {
  id: string;
  name?: string;
  description?: string | null;
}): Promise<ProjectDTO> {
  const setName = input.name !== undefined;
  const setDescription = input.description !== undefined;
  if (!setName && !setDescription) {
    return getProjectById(input.id);
  }
  try {
    const result = await pool.query<ProjectRow>(
      `UPDATE projects SET
         name        = CASE WHEN $2::boolean THEN $3::text ELSE name        END,
         description = CASE WHEN $4::boolean THEN $5::text ELSE description END
       WHERE id = $1
       RETURNING id, name, description, created_by, created_at, updated_at`,
      [
        input.id,
        setName,
        setName ? input.name!.trim() : null,
        setDescription,
        setDescription ? (input.description?.trim() || null) : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Проект не найден.');
    }
    return toDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'PROJECT_NAME_TAKEN',
        message: 'Проект с таким названием уже существует.',
      },
    });
  }
}

export async function getProjectById(id: string): Promise<ProjectDTO> {
  const result = await pool.query<ProjectRow>(
    `SELECT id, name, description, created_by, created_at, updated_at
       FROM projects WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Проект не найден.');
  }
  return toDTO(result.rows[0]);
}

export async function deleteProject(id: string): Promise<void> {
  try {
    const result = await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Проект не найден.');
    }
  } catch (err) {
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'PROJECT_IN_USE',
        message: 'Проект используется в отчётах или планах.',
      },
    });
  }
}
