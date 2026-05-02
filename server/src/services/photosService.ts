import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';
import {
  assertReportEditable,
  loadReportForAccess,
} from '../access/reportAccess.js';

export interface PhotoUpsertInput {
  user: AuthenticatedUser;
  id: string;
  report_id: string;
  object_key: string;
  thumb_object_key: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
}

export interface PhotoDTO {
  id: string;
  report_id: string;
  object_key: string;
  thumb_object_key: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  created_at: string;
}

interface PhotoRow {
  id: string;
  report_id: string;
  object_key: string;
  thumb_object_key: string | null;
  width: number | null;
  height: number | null;
  taken_at: Date | null;
  created_at: Date;
}

function toDTO(row: PhotoRow): PhotoDTO {
  return {
    id: row.id,
    report_id: row.report_id,
    object_key: row.object_key,
    thumb_object_key: row.thumb_object_key,
    width: row.width,
    height: row.height,
    taken_at: row.taken_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

const COLS = `id, report_id, object_key, thumb_object_key, width, height,
  taken_at, created_at`;

export async function upsertPhoto(input: PhotoUpsertInput): Promise<PhotoDTO> {
  const access = await loadReportForAccess(input.report_id);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  assertReportEditable(input.user, access);

  try {
    const result = await pool.query<PhotoRow>(
      `INSERT INTO report_photos (id, report_id, object_key, thumb_object_key,
                                  width, height, taken_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         report_id        = EXCLUDED.report_id,
         object_key       = EXCLUDED.object_key,
         thumb_object_key = EXCLUDED.thumb_object_key,
         width            = EXCLUDED.width,
         height           = EXCLUDED.height,
         taken_at         = EXCLUDED.taken_at
       RETURNING ${COLS}`,
      [
        input.id,
        input.report_id,
        input.object_key,
        input.thumb_object_key,
        input.width,
        input.height,
        input.taken_at,
      ],
    );
    return toDTO(result.rows[0]);
  } catch (err) {
    mapPgError(err);
  }
}

export async function deletePhoto(input: {
  user: AuthenticatedUser;
  id: string;
}): Promise<void> {
  const photo = await pool.query<{ report_id: string }>(
    `SELECT report_id FROM report_photos WHERE id = $1`,
    [input.id],
  );
  if (photo.rowCount === 0) {
    return; // idempotent
  }
  const access = await loadReportForAccess(photo.rows[0].report_id);
  if (!access) {
    return;
  }
  assertReportEditable(input.user, access);
  await pool.query(`DELETE FROM report_photos WHERE id = $1`, [input.id]);
}
