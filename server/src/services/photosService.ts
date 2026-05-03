import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';
import {
  assertReportEditable,
  assertReportReadable,
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
  // SELECT кастит таймштампы в text — см. COLS ниже.
  taken_at: string | null;
  created_at: string;
}

function toDTO(row: PhotoRow): PhotoDTO {
  return {
    id: row.id,
    report_id: row.report_id,
    object_key: row.object_key,
    thumb_object_key: row.thumb_object_key,
    width: row.width,
    height: row.height,
    taken_at: row.taken_at,
    created_at: row.created_at,
  };
}

const COLS = `id, report_id, object_key, thumb_object_key, width, height,
  taken_at::text AS taken_at, created_at::text AS created_at`;

export async function upsertPhoto(input: PhotoUpsertInput): Promise<PhotoDTO> {
  const access = await loadReportForAccess(input.report_id);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  assertReportEditable(input.user, access);

  try {
    // ON CONFLICT — позволяем обновить ту же фотографию (sync retry безопасен).
    // НО: WHERE EXCLUDED.report_id = report_photos.report_id защищает от
    // ситуации, когда из-за race/бага клиента та же photoId уйдёт под чужой
    // report — иначе фото молча перепрыгнуло бы между отчётами, потеряв связь
    // с оригиналом. Если строк затронуто 0 — бросаем PHOTO_REPORT_MISMATCH,
    // клиент классифицирует как permanent и создаёт sync_issue.
    const result = await pool.query<PhotoRow>(
      `INSERT INTO report_photos (id, report_id, object_key, thumb_object_key,
                                  width, height, taken_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         object_key       = EXCLUDED.object_key,
         thumb_object_key = EXCLUDED.thumb_object_key,
         width            = EXCLUDED.width,
         height           = EXCLUDED.height,
         taken_at         = EXCLUDED.taken_at
       WHERE report_photos.report_id = EXCLUDED.report_id
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
    if (result.rowCount === 0) {
      // INSERT потерпел ON CONFLICT, но WHERE не пустил UPDATE — значит
      // эта photoId уже принадлежит другому отчёту.
      throw new AppError(
        409,
        'PHOTO_REPORT_MISMATCH',
        'Эта фотография уже привязана к другому отчёту.',
      );
    }
    return toDTO(result.rows[0]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapPgError(err);
  }
}

/**
 * GET /api/report-photos/:id — нужен клиенту для самовосстановления sync:
 * после timeout/network error при PUT в S3 фото может быть уже на сервере,
 * клиент проверяет наличие и помечает synced без повторной заливки.
 * Возвращает null, если строки нет — роут отдаёт 404.
 */
export async function getPhotoById(input: {
  user: AuthenticatedUser;
  id: string;
}): Promise<PhotoDTO | null> {
  const result = await pool.query<PhotoRow>(
    `SELECT ${COLS} FROM report_photos WHERE id = $1`,
    [input.id],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  const access = await loadReportForAccess(row.report_id);
  if (!access) return null;
  await assertReportReadable(input.user, access);
  return toDTO(row);
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
