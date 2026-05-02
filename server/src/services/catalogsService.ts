import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';

// ========================================================================
// Work types & work assignments — общая структура
// ========================================================================

export interface NamedDictDTO {
  id: string;
  name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

interface NamedDictRow {
  id: string;
  name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
}

function toDictDTO(row: NamedDictRow): NamedDictDTO {
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
  };
}

function tableExpr(kind: 'work_types' | 'work_assignments'): string {
  return kind;
}

export async function listActiveDict(
  kind: 'work_types' | 'work_assignments',
): Promise<NamedDictDTO[]> {
  const result = await pool.query<NamedDictRow>(
    `SELECT id, name::text AS name, is_active, created_by, created_at
       FROM ${tableExpr(kind)}
      WHERE is_active = true
      ORDER BY name ASC
      LIMIT 1000`,
  );
  return result.rows.map(toDictDTO);
}

export async function listAllDict(
  kind: 'work_types' | 'work_assignments',
): Promise<NamedDictDTO[]> {
  const result = await pool.query<NamedDictRow>(
    `SELECT id, name::text AS name, is_active, created_by, created_at
       FROM ${tableExpr(kind)}
      ORDER BY name ASC
      LIMIT 1000`,
  );
  return result.rows.map(toDictDTO);
}

/**
 * Public POST: пользователь оффлайн создал запись с client UUID.
 * Дубль по name (citext UNIQUE) → возвращаем существующую запись (idempotent).
 * Дубль по id (другой пользователь успел) → возвращаем существующую запись.
 */
export async function upsertDictPublic(input: {
  kind: 'work_types' | 'work_assignments';
  id: string | null;
  name: string;
  createdBy: string;
}): Promise<NamedDictDTO> {
  const name = input.name.trim();
  if (!name) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Название не может быть пустым.');
  }

  // Try by id first if provided.
  if (input.id) {
    const existing = await pool.query<NamedDictRow>(
      `SELECT id, name::text AS name, is_active, created_by, created_at
         FROM ${tableExpr(input.kind)} WHERE id = $1`,
      [input.id],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return toDictDTO(existing.rows[0]);
    }
  }

  // Try by name (citext unique).
  const byName = await pool.query<NamedDictRow>(
    `SELECT id, name::text AS name, is_active, created_by, created_at
       FROM ${tableExpr(input.kind)} WHERE name = $1`,
    [name],
  );
  if (byName.rowCount && byName.rowCount > 0) {
    return toDictDTO(byName.rows[0]);
  }

  try {
    const result = await pool.query<NamedDictRow>(
      `INSERT INTO ${tableExpr(input.kind)} (id, name, is_active, created_by)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, true, $3)
       RETURNING id, name::text AS name, is_active, created_by, created_at`,
      [input.id, name, input.createdBy],
    );
    return toDictDTO(result.rows[0]);
  } catch (err) {
    // Race: select again.
    const races = await pool.query<NamedDictRow>(
      `SELECT id, name::text AS name, is_active, created_by, created_at
         FROM ${tableExpr(input.kind)} WHERE name = $1`,
      [name],
    );
    if (races.rowCount && races.rowCount > 0) {
      return toDictDTO(races.rows[0]);
    }
    mapPgError(err);
  }
}

export async function createDictAdmin(input: {
  kind: 'work_types' | 'work_assignments';
  name: string;
  createdBy: string;
}): Promise<NamedDictDTO> {
  const name = input.name.trim();
  try {
    const result = await pool.query<NamedDictRow>(
      `INSERT INTO ${tableExpr(input.kind)} (name, is_active, created_by)
       VALUES ($1, true, $2)
       RETURNING id, name::text AS name, is_active, created_by, created_at`,
      [name, input.createdBy],
    );
    return toDictDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'DICT_NAME_TAKEN',
        message: 'Запись с таким названием уже существует.',
      },
    });
  }
}

export async function renameDictAdmin(input: {
  kind: 'work_types' | 'work_assignments';
  id: string;
  name: string;
}): Promise<NamedDictDTO> {
  const name = input.name.trim();
  try {
    const result = await pool.query<NamedDictRow>(
      `UPDATE ${tableExpr(input.kind)}
          SET name = $1
        WHERE id = $2
        RETURNING id, name::text AS name, is_active, created_by, created_at`,
      [name, input.id],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Запись не найдена.');
    }
    return toDictDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'DICT_NAME_TAKEN',
        message: 'Запись с таким названием уже существует.',
      },
    });
  }
}

export async function setDictActiveAdmin(input: {
  kind: 'work_types' | 'work_assignments';
  id: string;
  isActive: boolean;
}): Promise<NamedDictDTO> {
  const result = await pool.query<NamedDictRow>(
    `UPDATE ${tableExpr(input.kind)}
        SET is_active = $1
      WHERE id = $2
      RETURNING id, name::text AS name, is_active, created_by, created_at`,
    [input.isActive, input.id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Запись не найдена.');
  }
  return toDictDTO(result.rows[0]);
}

// ========================================================================
// Performers
// ========================================================================

export type PerformerKind = 'contractor' | 'own_forces';

export interface PerformerDTO {
  id: string;
  name: string;
  kind: PerformerKind;
  is_active: boolean;
  created_at: string;
}

interface PerformerRow {
  id: string;
  name: string;
  kind: PerformerKind;
  is_active: boolean;
  created_at: Date;
}

function toPerformerDTO(row: PerformerRow): PerformerDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}

export async function listActivePerformers(): Promise<PerformerDTO[]> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at
       FROM performers
      WHERE is_active = true
      ORDER BY kind ASC, name ASC
      LIMIT 1000`,
  );
  return result.rows.map(toPerformerDTO);
}

export async function listAllPerformers(): Promise<PerformerDTO[]> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at
       FROM performers
      ORDER BY kind ASC, name ASC
      LIMIT 1000`,
  );
  return result.rows.map(toPerformerDTO);
}

export async function createPerformer(input: {
  name: string;
  kind: PerformerKind;
}): Promise<PerformerDTO> {
  const name = input.name.trim();
  try {
    const result = await pool.query<PerformerRow>(
      `INSERT INTO performers (name, kind, is_active)
       VALUES ($1, $2::performer_kind, true)
       RETURNING id, name::text AS name, kind, is_active, created_at`,
      [name, input.kind],
    );
    return toPerformerDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'PERFORMER_NAME_TAKEN',
        message: 'Исполнитель с таким названием и видом уже существует.',
      },
    });
  }
}

export async function updatePerformer(input: {
  id: string;
  name?: string;
  kind?: PerformerKind;
}): Promise<PerformerDTO> {
  const setName = input.name !== undefined;
  const setKind = input.kind !== undefined;
  if (!setName && !setKind) {
    return getPerformerById(input.id);
  }
  try {
    const result = await pool.query<PerformerRow>(
      `UPDATE performers SET
         name = CASE WHEN $2::boolean THEN $3::text          ELSE name END,
         kind = CASE WHEN $4::boolean THEN $5::performer_kind ELSE kind END
       WHERE id = $1
       RETURNING id, name::text AS name, kind, is_active, created_at`,
      [
        input.id,
        setName,
        setName ? input.name!.trim() : null,
        setKind,
        setKind ? input.kind! : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Исполнитель не найден.');
    }
    return toPerformerDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err, {
      uniqueViolation: {
        code: 'PERFORMER_NAME_TAKEN',
        message: 'Исполнитель с таким названием и видом уже существует.',
      },
    });
  }
}

export async function setPerformerActive(input: {
  id: string;
  isActive: boolean;
}): Promise<PerformerDTO> {
  const result = await pool.query<PerformerRow>(
    `UPDATE performers SET is_active = $1 WHERE id = $2
     RETURNING id, name::text AS name, kind, is_active, created_at`,
    [input.isActive, input.id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Исполнитель не найден.');
  }
  return toPerformerDTO(result.rows[0]);
}

export async function getPerformerById(id: string): Promise<PerformerDTO> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at
       FROM performers WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Исполнитель не найден.');
  }
  return toPerformerDTO(result.rows[0]);
}
