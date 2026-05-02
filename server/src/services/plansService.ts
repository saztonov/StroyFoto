import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';
import {
  assertProjectExists,
  assertProjectMember,
  getUserProjectIds,
} from '../access/projectAccess.js';

export interface PlanDTO {
  id: string;
  project_id: string;
  name: string;
  floor: string | null;
  building: string | null;
  section: string | null;
  object_key: string;
  page_count: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  project_id: string;
  name: string;
  floor: string | null;
  building: string | null;
  section: string | null;
  object_key: string;
  page_count: number | null;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDTO(row: PlanRow): PlanDTO {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    floor: row.floor,
    building: row.building,
    section: row.section,
    object_key: row.object_key,
    page_count: row.page_count,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `id, project_id, name, floor, building, section,
  object_key, page_count, uploaded_by, created_at, updated_at`;

export async function listPlansForUser(
  user: AuthenticatedUser,
): Promise<PlanDTO[]> {
  const projectIds = await getUserProjectIds(user);
  const result = await pool.query<PlanRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM plans
      WHERE ($1::uuid[] IS NULL OR project_id = ANY($1::uuid[]))
      ORDER BY created_at DESC
      LIMIT 2000`,
    [projectIds],
  );
  return result.rows.map(toDTO);
}

export async function listPlansForProject(
  user: AuthenticatedUser,
  projectId: string,
): Promise<PlanDTO[]> {
  await assertProjectMember(user, projectId);
  const result = await pool.query<PlanRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM plans
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT 2000`,
    [projectId],
  );
  return result.rows.map(toDTO);
}

export async function createPlan(input: {
  user: AuthenticatedUser;
  id?: string | null;
  project_id: string;
  name: string;
  floor: string | null;
  building: string | null;
  section: string | null;
  object_key: string;
  page_count: number | null;
}): Promise<PlanDTO> {
  await assertProjectExists(input.project_id);
  await assertProjectMember(input.user, input.project_id);
  try {
    const result = await pool.query<PlanRow>(
      `INSERT INTO plans (id, project_id, name, floor, building, section,
                          object_key, page_count, uploaded_by)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6,
               $7, $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.id ?? null,
        input.project_id,
        input.name.trim(),
        input.floor,
        input.building,
        input.section,
        input.object_key,
        input.page_count,
        input.user.id,
      ],
    );
    return toDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'PROJECT_NOT_FOUND',
        message: 'Проект не найден.',
      },
    });
  }
}

async function loadPlan(id: string): Promise<PlanRow> {
  const result = await pool.query<PlanRow>(
    `SELECT ${SELECT_COLUMNS} FROM plans WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'План не найден.');
  }
  return result.rows[0];
}

export async function updatePlan(input: {
  user: AuthenticatedUser;
  id: string;
  name?: string;
  floor?: string | null;
  building?: string | null;
  section?: string | null;
  page_count?: number | null;
}): Promise<PlanDTO> {
  const plan = await loadPlan(input.id);
  await assertProjectMember(input.user, plan.project_id);
  if (
    input.user.role !== 'admin' &&
    plan.uploaded_by !== input.user.id &&
    (input.name !== undefined ||
      input.floor !== undefined ||
      input.building !== undefined ||
      input.section !== undefined)
  ) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Изменять метаданные плана может только загрузивший или администратор.',
    );
  }
  const setName = input.name !== undefined;
  const setFloor = input.floor !== undefined;
  const setBuilding = input.building !== undefined;
  const setSection = input.section !== undefined;
  const setPageCount = input.page_count !== undefined;
  if (
    !setName &&
    !setFloor &&
    !setBuilding &&
    !setSection &&
    !setPageCount
  ) {
    return toDTO(plan);
  }

  const result = await pool.query<PlanRow>(
    `UPDATE plans SET
       name       = CASE WHEN $2::boolean THEN $3::text     ELSE name       END,
       floor      = CASE WHEN $4::boolean THEN $5::text     ELSE floor      END,
       building   = CASE WHEN $6::boolean THEN $7::text     ELSE building   END,
       section    = CASE WHEN $8::boolean THEN $9::text     ELSE section    END,
       page_count = CASE WHEN $10::boolean THEN $11::int    ELSE page_count END
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.id,
      setName,
      setName ? input.name!.trim() : null,
      setFloor,
      setFloor ? input.floor : null,
      setBuilding,
      setBuilding ? input.building : null,
      setSection,
      setSection ? input.section : null,
      setPageCount,
      setPageCount ? input.page_count : null,
    ],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'План не найден.');
  }
  return toDTO(result.rows[0]);
}

export async function deletePlan(input: {
  user: AuthenticatedUser;
  id: string;
}): Promise<void> {
  const plan = await loadPlan(input.id);
  await assertProjectMember(input.user, plan.project_id);
  if (input.user.role !== 'admin' && plan.uploaded_by !== input.user.id) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Удалить план может только загрузивший или администратор.',
    );
  }
  try {
    const result = await pool.query(`DELETE FROM plans WHERE id = $1`, [
      input.id,
    ]);
    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'План не найден.');
    }
  } catch (err) {
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'PLAN_IN_USE',
        message: 'План используется в отчётах. Удалите связанные отметки.',
      },
    });
  }
}
