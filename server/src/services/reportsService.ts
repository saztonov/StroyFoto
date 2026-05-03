import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import { mapPgError } from '../http/pgErrors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';
import {
  assertProjectMember,
  getUserProjectIds,
} from '../access/projectAccess.js';
import {
  assertReportEditable,
  assertReportReadable,
  loadReportForAccess,
} from '../access/reportAccess.js';

export interface ReportListItemDTO {
  id: string;
  project_id: string;
  work_type_id: string;
  performer_id: string;
  work_assignment_id: string | null;
  plan_id: string | null;
  author_id: string;
  description: string | null;
  taken_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReportListRow {
  id: string;
  project_id: string;
  work_type_id: string;
  performer_id: string;
  work_assignment_id: string | null;
  plan_id: string | null;
  author_id: string;
  description: string | null;
  // taken_at, created_at, updated_at кастятся к ::text в SELECT'ах,
  // чтобы сохранить микросекунды Postgres для точного OCC-сравнения.
  taken_at: string | null;
  created_at: string;
  updated_at: string;
}

function toListItem(row: ReportListRow): ReportListItemDTO {
  return {
    id: row.id,
    project_id: row.project_id,
    work_type_id: row.work_type_id,
    performer_id: row.performer_id,
    work_assignment_id: row.work_assignment_id,
    plan_id: row.plan_id,
    author_id: row.author_id,
    description: row.description,
    taken_at: row.taken_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface PhotoNestedDTO {
  id: string;
  object_key: string;
  thumb_object_key: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
}

export interface MarkNestedDTO {
  plan_id: string;
  page: number;
  x_norm: number;
  y_norm: number;
}

export interface ReportFullDTO extends ReportListItemDTO {
  report_photos: PhotoNestedDTO[];
  report_plan_marks: MarkNestedDTO[];
  author_name: string | null;
}

interface ReportFullRow extends ReportListRow {
  report_photos: PhotoNestedDTO[] | null;
  report_plan_marks: MarkNestedDTO[] | null;
  author_name: string | null;
}

// to_jsonb() в SELECT возвращает поле taken_at вложенного report_photos
// уже как string, так что mapping в FullDTO не нужен.

// taken_at/created_at/updated_at кастятся в text — иначе pg-driver
// конвертирует в JS Date с потерей микросекунд, и OCC через WHERE updated_at = $N
// иногда даёт ложное несовпадение для свежих ответов сервера.
const LIST_COLUMNS = `id, project_id, work_type_id, performer_id, work_assignment_id,
  plan_id, author_id, description,
  taken_at::text AS taken_at,
  created_at::text AS created_at,
  updated_at::text AS updated_at`;

async function assertPlanInProject(
  planId: string,
  projectId: string,
): Promise<void> {
  const r = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM plans WHERE id = $1`,
    [planId],
  );
  if (r.rowCount === 0 || r.rows[0].project_id !== projectId) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'plan_id не относится к проекту отчёта.',
    );
  }
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as Partial<CursorPayload>;
    if (typeof obj.createdAt !== 'string' || typeof obj.id !== 'string') {
      return null;
    }
    return { createdAt: obj.createdAt, id: obj.id };
  } catch {
    return null;
  }
}

export async function listReports(input: {
  user: AuthenticatedUser;
  cursor: string | null;
  limit: number;
}): Promise<{ items: ReportListItemDTO[]; nextCursor: string | null }> {
  const projectIds = await getUserProjectIds(input.user);
  // Стабильный keyset cursor: (created_at DESC, id DESC). Без вторичного
  // ключа отчёты с одинаковым created_at могут терять страницу или
  // дублироваться. Cursor opaque — клиент гоняет его обратно как есть.
  const cursorPayload = decodeCursor(input.cursor);
  const result = await pool.query<ReportListRow>(
    `SELECT ${LIST_COLUMNS}
       FROM reports
      WHERE ($1::uuid[] IS NULL OR project_id = ANY($1::uuid[]))
        AND (
          $2::timestamptz IS NULL
          OR created_at < $2::timestamptz
          OR (created_at = $2::timestamptz AND id < $3::uuid)
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [
      projectIds,
      cursorPayload?.createdAt ?? null,
      cursorPayload?.id ?? null,
      input.limit,
    ],
  );
  const items = result.rows.map(toListItem);
  const last = items[items.length - 1];
  const nextCursor =
    items.length === input.limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;
  return { items, nextCursor };
}

const FULL_SQL = `
  SELECT r.id, r.project_id, r.work_type_id, r.performer_id, r.work_assignment_id,
         r.plan_id, r.author_id, r.description,
         r.taken_at::text AS taken_at,
         r.created_at::text AS created_at,
         r.updated_at::text AS updated_at,
         (SELECT coalesce(json_agg(json_build_object(
                   'id', p.id,
                   'object_key', p.object_key,
                   'thumb_object_key', p.thumb_object_key,
                   'width', p.width,
                   'height', p.height,
                   'taken_at', p.taken_at
                 ) ORDER BY p.created_at), '[]'::json)
            FROM report_photos p WHERE p.report_id = r.id) AS report_photos,
         (SELECT coalesce(json_agg(json_build_object(
                   'plan_id', m.plan_id,
                   'page', m.page,
                   'x_norm', m.x_norm,
                   'y_norm', m.y_norm
                 )), '[]'::json)
            FROM report_plan_marks m WHERE m.report_id = r.id) AS report_plan_marks,
         prof.full_name AS author_name
    FROM reports r
    LEFT JOIN profiles prof ON prof.id = r.author_id
   WHERE r.id = $1
`;

function toFullDTO(row: ReportFullRow): ReportFullDTO {
  return {
    ...toListItem(row),
    report_photos: row.report_photos ?? [],
    report_plan_marks: row.report_plan_marks ?? [],
    author_name: row.author_name,
  };
}

export async function getReportById(input: {
  user: AuthenticatedUser;
  id: string;
}): Promise<ReportFullDTO> {
  const access = await loadReportForAccess(input.id);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  await assertReportReadable(input.user, access);

  const result = await pool.query<ReportFullRow>(FULL_SQL, [input.id]);
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  return toFullDTO(result.rows[0]);
}

export async function createReport(input: {
  user: AuthenticatedUser;
  id: string;
  project_id: string;
  work_type_id: string;
  performer_id: string;
  work_assignment_id: string | null;
  plan_id: string | null;
  description: string | null;
  taken_at: string | null;
  author_id?: string | null;
}): Promise<ReportFullDTO> {
  // Non-admin: author_id forced to self.
  const authorId =
    input.user.role === 'admin' && input.author_id
      ? input.author_id
      : input.user.id;

  // Membership check (admin bypass).
  await assertProjectMember(input.user, input.project_id);

  if (input.plan_id) {
    await assertPlanInProject(input.plan_id, input.project_id);
  }

  try {
    await pool.query(
      `INSERT INTO reports (id, project_id, work_type_id, performer_id,
                            work_assignment_id, plan_id, author_id,
                            description, taken_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        input.id,
        input.project_id,
        input.work_type_id,
        input.performer_id,
        input.work_assignment_id,
        input.plan_id,
        authorId,
        input.description,
        input.taken_at,
      ],
    );
  } catch (err) {
    // Idempotency: same id → return existing.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === '23505'
    ) {
      return getReportById({ user: input.user, id: input.id });
    }
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'FK_VIOLATION',
        message: 'Связанные данные не найдены (проект, вид работ или исполнитель).',
      },
    });
  }
  return getReportById({ user: input.user, id: input.id });
}

export interface ReportPatchInput {
  user: AuthenticatedUser;
  id: string;
  expectedUpdatedAt: string | null;
  work_type_id?: string;
  performer_id?: string;
  work_assignment_id?: string | null;
  description?: string | null;
  taken_at?: string | null;
  plan_id?: string | null;
}

export async function updateReportWithOcc(
  input: ReportPatchInput,
): Promise<ReportFullDTO> {
  const access = await loadReportForAccess(input.id);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  assertReportEditable(input.user, access);

  const setWorkType = input.work_type_id !== undefined;
  const setPerformer = input.performer_id !== undefined;
  const setWorkAssignment = input.work_assignment_id !== undefined;
  const setDescription = input.description !== undefined;
  const setTakenAt = input.taken_at !== undefined;
  const setPlan = input.plan_id !== undefined;

  if (
    !setWorkType &&
    !setPerformer &&
    !setWorkAssignment &&
    !setDescription &&
    !setTakenAt &&
    !setPlan
  ) {
    return getReportById({ user: input.user, id: input.id });
  }

  if (setPlan && input.plan_id) {
    await assertPlanInProject(input.plan_id, access.project_id);
  }

  try {
    // expectedUpdatedAt передаётся как text — сравниваем после cast в timestamptz
    // на стороне Postgres, чтобы не терять микросекунды через JS Date.
    // Клиент хранит исходную строку из ответа сервера (db.ts → setTypeParser).
    const result = await pool.query<{ id: string }>(
      `UPDATE reports SET
         work_type_id       = CASE WHEN $2::boolean THEN $3::uuid ELSE work_type_id END,
         performer_id       = CASE WHEN $4::boolean THEN $5::uuid ELSE performer_id END,
         work_assignment_id = CASE WHEN $6::boolean THEN $7::uuid ELSE work_assignment_id END,
         description        = CASE WHEN $8::boolean THEN $9::text ELSE description END,
         taken_at           = CASE WHEN $10::boolean THEN $11::timestamptz ELSE taken_at END,
         plan_id            = CASE WHEN $12::boolean THEN $13::uuid ELSE plan_id END
       WHERE id = $1
         AND ($14::text IS NULL OR updated_at = $14::text::timestamptz)
       RETURNING id`,
      [
        input.id,
        setWorkType,
        setWorkType ? input.work_type_id : null,
        setPerformer,
        setPerformer ? input.performer_id : null,
        setWorkAssignment,
        setWorkAssignment ? input.work_assignment_id : null,
        setDescription,
        setDescription ? input.description : null,
        setTakenAt,
        setTakenAt ? input.taken_at : null,
        setPlan,
        setPlan ? input.plan_id : null,
        input.expectedUpdatedAt,
      ],
    );
    if (result.rowCount === 0) {
      throw new AppError(
        409,
        'CONFLICT',
        'Отчёт был изменён другим пользователем. Обновите данные и повторите.',
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'FK_VIOLATION',
        message: 'Связанные данные не найдены.',
      },
    });
  }
  return getReportById({ user: input.user, id: input.id });
}

export async function deleteReport(input: {
  user: AuthenticatedUser;
  id: string;
}): Promise<void> {
  const access = await loadReportForAccess(input.id);
  if (!access) {
    return; // idempotent — не было и нет
  }
  assertReportEditable(input.user, access);
  await pool.query(`DELETE FROM reports WHERE id = $1`, [input.id]);
}

export async function setPlanMark(input: {
  user: AuthenticatedUser;
  reportId: string;
  plan_id: string;
  page: number;
  x_norm: number;
  y_norm: number;
}): Promise<{ ok: true }> {
  const access = await loadReportForAccess(input.reportId);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  assertReportEditable(input.user, access);
  await assertPlanInProject(input.plan_id, access.project_id);
  try {
    await pool.query(
      `INSERT INTO report_plan_marks (id, report_id, plan_id, page, x_norm, y_norm)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       ON CONFLICT (report_id) DO UPDATE
         SET plan_id = EXCLUDED.plan_id,
             page    = EXCLUDED.page,
             x_norm  = EXCLUDED.x_norm,
             y_norm  = EXCLUDED.y_norm`,
      [input.reportId, input.plan_id, input.page, input.x_norm, input.y_norm],
    );
  } catch (err) {
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'FK_VIOLATION',
        message: 'План не найден.',
      },
      checkViolation: {
        code: 'CHECK_VIOLATION',
        message: 'Координаты метки должны быть в диапазоне [0, 1].',
      },
    });
  }
  return { ok: true };
}

export async function clearPlanMark(input: {
  user: AuthenticatedUser;
  reportId: string;
}): Promise<{ ok: true }> {
  const access = await loadReportForAccess(input.reportId);
  if (!access) {
    return { ok: true };
  }
  assertReportEditable(input.user, access);
  await pool.query(`DELETE FROM report_plan_marks WHERE report_id = $1`, [
    input.reportId,
  ]);
  return { ok: true };
}
