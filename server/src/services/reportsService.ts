import type { PoolClient } from 'pg';
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

export interface PerformerNestedDTO {
  id: string;
  name: string;
}

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
  // Имена справочников резолвятся на сервере, а не на клиенте: клиент грузит
  // справочники с ?active=true, поэтому архивная позиция отображалась бы как
  // «—». История не должна зависеть от того, активна ли позиция сейчас.
  work_type_name: string | null;
  work_assignment_name: string | null;
  // Подрядчики отчёта: основной (performer_id) первым, остальные по uuid.
  // Одним связанным массивом, а не двумя параллельными (ids + names) — так
  // рассинхрон соответствия id → имя невозможен по конструкции. По той же
  // причине, что и имена справочников выше, имена приходят с сервера:
  // архивный подрядчик не вернётся в публичном справочнике.
  performers: PerformerNestedDTO[];
  // OCC-версия набора фото-точек. Отдаётся и в списке: reconcile по ней
  // понимает, у каких отчётов нужно перечитать детали. bigint приводится
  // к text, чтобы не потерять точность на JS-числе.
  photo_marks_version: string;
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
  work_type_name: string | null;
  work_assignment_name: string | null;
  performers: PerformerNestedDTO[] | null;
  photo_marks_version: string | null;
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
    work_type_name: row.work_type_name,
    work_assignment_name: row.work_assignment_name,
    performers: row.performers ?? [],
    photo_marks_version: row.photo_marks_version ?? '0',
  };
}

// Подрядчики отчёта одним упорядоченным подзапросом: основной первым, остальные
// по uuid. created_at для порядка непригоден — now() внутри транзакции одинаков
// для всех строк, вставленных одним запросом.
// Требует, чтобы во внешнем запросе таблица reports была под алиасом `r`.
const PERFORMERS_SELECT = `
         (SELECT coalesce(json_agg(json_build_object(
                   'id', pf.id,
                   'name', pf.name::text
                 ) ORDER BY (pf.id <> r.performer_id), pf.id), '[]'::json)
            FROM report_performers rp
            JOIN performers pf ON pf.id = rp.performer_id
           WHERE rp.report_id = r.id) AS performers`;

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
  /**
   * null — легаси-метка «одна общая на отчёт» из report_plan_marks.
   * uuid — точка конкретной фотографии из report_photo_plan_marks.
   *
   * Поле добавлено в конец: старый клиент читает `report_plan_marks?.[0]`,
   * то есть первый элемент, поэтому агрегат обязан отдавать легаси-метку
   * первой (см. MARKS_SELECT).
   */
  photo_id: string | null;
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

function dictLabel(kind: 'work_types' | 'work_assignments'): string {
  return kind === 'work_types' ? 'Вид работ' : 'Назначение работ';
}

/**
 * Проверяет, что позиция справочника активна, и удерживает её строку до конца
 * транзакции через FOR SHARE.
 *
 * Блокировка обязательна: без неё остаётся гонка «сервер увидел позицию
 * активной → админ деактивировал → отчёт всё равно записался». Конкурирующий
 * UPDATE ... SET is_active = false возьмёт несовместимую блокировку строки и
 * подождёт нашего COMMIT.
 *
 * Вызывать ТОЛЬКО когда значение действительно меняется: историческую ссылку
 * на архивную позицию в уже существующем отчёте трогать нельзя, иначе старые
 * клиенты, присылающие в PATCH все поля, не смогут отредактировать даже
 * описание.
 */
async function assertDictActiveForWrite(
  client: PoolClient,
  kind: 'work_types' | 'work_assignments',
  id: string,
): Promise<void> {
  const r = await client.query<{ name: string; is_active: boolean }>(
    `SELECT name::text AS name, is_active FROM ${kind} WHERE id = $1 FOR SHARE`,
    [id],
  );
  if (r.rowCount === 0) {
    throw new AppError(
      422,
      'FK_VIOLATION',
      `${dictLabel(kind)} не найден.`,
    );
  }
  if (!r.rows[0].is_active) {
    throw new AppError(
      409,
      'DICT_INACTIVE',
      `${dictLabel(kind)} «${r.rows[0].name}» отключён администратором. Выберите другой.`,
      // Клиент по этим полям понимает, какую именно позицию заменить, и
      // дедуплицирует sync-issue — без разбора текста сообщения.
      { catalogKind: kind === 'work_types' ? 'work_type' : 'work_assignment', catalogId: id },
    );
  }
}

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

export interface ReportListItemWithPhotosDTO extends ReportListItemDTO {
  report_photos: PhotoNestedDTO[];
}

interface ReportListRowWithPhotos extends ReportListRow {
  report_photos: PhotoNestedDTO[] | null;
}

export async function listReports(input: {
  user: AuthenticatedUser;
  cursor: string | null;
  limit: number;
  projectId?: string | null;
  workTypeIds?: string[] | null;
  performerIds?: string[] | null;
  months?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  includePhotos?: boolean;
}): Promise<{
  items: ReportListItemDTO[] | ReportListItemWithPhotosDTO[];
  nextCursor: string | null;
}> {
  const projectIds = await getUserProjectIds(input.user);
  // Если запрошен конкретный projectId, который не входит в membership пользователя
  // (для не-admin) — отдаём пусто. Admin (projectIds=null) пропускается.
  if (
    input.projectId &&
    projectIds !== null &&
    !projectIds.includes(input.projectId)
  ) {
    return { items: [], nextCursor: null };
  }
  // Стабильный keyset cursor: (created_at DESC, id DESC). Без вторичного
  // ключа отчёты с одинаковым created_at могут терять страницу или
  // дублироваться. Cursor opaque — клиент гоняет его обратно как есть.
  const cursorPayload = decodeCursor(input.cursor);

  const params: unknown[] = [
    projectIds,
    cursorPayload?.createdAt ?? null,
    cursorPayload?.id ?? null,
    input.limit,
    input.projectId ?? null,
    input.workTypeIds && input.workTypeIds.length > 0
      ? input.workTypeIds
      : null,
    input.months && input.months.length > 0 ? input.months : null,
    input.dateFrom ?? null,
    input.dateTo ?? null,
    input.performerIds && input.performerIds.length > 0
      ? input.performerIds
      : null,
  ];

  const photosSelect = input.includePhotos
    ? `,
         (SELECT coalesce(json_agg(json_build_object(
                   'id', p.id,
                   'object_key', p.object_key,
                   'thumb_object_key', p.thumb_object_key,
                   'width', p.width,
                   'height', p.height,
                   'taken_at', p.taken_at
                 ) ORDER BY p.created_at), '[]'::json)
            FROM report_photos p WHERE p.report_id = r.id) AS report_photos`
    : '';

  const sql = `
    SELECT r.id, r.project_id, r.work_type_id, r.performer_id, r.work_assignment_id,
           r.plan_id, r.author_id, r.description,
           r.taken_at::text AS taken_at,
           r.created_at::text AS created_at,
           r.updated_at::text AS updated_at,
           wt.name::text AS work_type_name,
           wa.name::text AS work_assignment_name,
           r.photo_marks_version::text AS photo_marks_version,${PERFORMERS_SELECT}${photosSelect}
      FROM reports r
      LEFT JOIN work_types wt ON wt.id = r.work_type_id
      LEFT JOIN work_assignments wa ON wa.id = r.work_assignment_id
     WHERE ($1::uuid[] IS NULL OR r.project_id = ANY($1::uuid[]))
       AND (
         $2::timestamptz IS NULL
         OR r.created_at < $2::timestamptz
         OR (r.created_at = $2::timestamptz AND r.id < $3::uuid)
       )
       AND ($5::uuid IS NULL OR r.project_id = $5::uuid)
       AND ($6::uuid[] IS NULL OR r.work_type_id = ANY($6::uuid[]))
       AND ($7::text[] IS NULL OR to_char(r.created_at, 'YYYY-MM') = ANY($7::text[]))
       AND ($8::timestamptz IS NULL OR r.created_at >= $8::timestamptz)
       AND ($9::timestamptz IS NULL OR r.created_at <= $9::timestamptz)
       AND ($10::uuid[] IS NULL OR EXISTS (
             SELECT 1 FROM report_performers rpf
              WHERE rpf.report_id = r.id
                AND rpf.performer_id = ANY($10::uuid[])))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $4
  `;

  if (input.includePhotos) {
    const result = await pool.query<ReportListRowWithPhotos>(sql, params);
    const items: ReportListItemWithPhotosDTO[] = result.rows.map((row) => ({
      ...toListItem(row),
      report_photos: row.report_photos ?? [],
    }));
    const last = items[items.length - 1];
    const nextCursor =
      items.length === input.limit && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null;
    return { items, nextCursor };
  }

  const result = await pool.query<ReportListRow>(sql, params);
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
         -- Объединение легаси-метки и точек фотографий. Порядок не косметика:
         -- старый клиент читает report_plan_marks[0], поэтому легаси-метка
         -- обязана идти первой, иначе он покажет случайную точку фото.
         (SELECT coalesce(json_agg(json_build_object(
                   'plan_id', x.plan_id,
                   'page', x.page,
                   'x_norm', x.x_norm,
                   'y_norm', x.y_norm,
                   'photo_id', x.photo_id
                 ) ORDER BY x.kind, x.created_at, x.id), '[]'::json)
            FROM (
              SELECT 0 AS kind, m.created_at, m.id, m.plan_id, m.page,
                     m.x_norm, m.y_norm, NULL::uuid AS photo_id
                FROM report_plan_marks m WHERE m.report_id = r.id
              UNION ALL
              SELECT 1, pm.created_at, pm.id, pm.plan_id, pm.page,
                     pm.x_norm, pm.y_norm, pm.photo_id
                FROM report_photo_plan_marks pm WHERE pm.report_id = r.id
            ) x) AS report_plan_marks,
         prof.full_name AS author_name,
         wt.name::text AS work_type_name,
         wa.name::text AS work_assignment_name,
         r.photo_marks_version::text AS photo_marks_version,${PERFORMERS_SELECT}
    FROM reports r
    LEFT JOIN profiles prof ON prof.id = r.author_id
    LEFT JOIN work_types wt ON wt.id = r.work_type_id
    LEFT JOIN work_assignments wa ON wa.id = r.work_assignment_id
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

/**
 * Дедупликация набора подрядчиков с сохранением порядка: первое вхождение
 * выигрывает. Дубль нарушил бы PK report_performers и дал 23505, который
 * createReport трактует как идемпотентный повтор, — ошибка была бы проглочена.
 * Отвергать дубли нельзя: sync-операция падала бы вечно и блокировала черновик.
 */
function dedupePerformerIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export async function createReport(input: {
  user: AuthenticatedUser;
  id: string;
  project_id: string;
  work_type_id: string;
  performer_id: string;
  performer_ids: string[];
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

  // Проверка активности справочников и вставка — в одной транзакции, иначе
  // между ними помещается деактивация (см. assertDictActiveForWrite).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await assertDictActiveForWrite(client, 'work_types', input.work_type_id);
      if (input.work_assignment_id) {
        await assertDictActiveForWrite(
          client,
          'work_assignments',
          input.work_assignment_id,
        );
      }
      await client.query(
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
      // Триггер sync_report_primary_performer уже вставил основную связь —
      // ON CONFLICT DO NOTHING делает повтор безобидным.
      await client.query(
        `INSERT INTO report_performers (report_id, performer_id)
         SELECT $1::uuid, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [input.id, dedupePerformerIds(input.performer_ids)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof AppError) throw err;
      // Idempotency: повторная отправка того же отчёта → вернуть существующий.
      // Проверка сужена до конкретного констрейнта: раньше сюда попал бы любой
      // 23505, в том числе нарушение PK report_performers, и реальная ошибка
      // молча превратилась бы в «успешный» ответ.
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === '23505' &&
        (err as { constraint?: string }).constraint === 'reports_pkey'
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
  } finally {
    client.release();
  }
  return getReportById({ user: input.user, id: input.id });
}

export interface ReportPatchInput {
  user: AuthenticatedUser;
  id: string;
  expectedUpdatedAt: string | null;
  work_type_id?: string;
  performer_id?: string;
  // Полный набор подрядчиков. undefined означает «клиент не умеет множественность»
  // (старая версия PWA) — набор в этом случае не заменяется целиком, см. решение
  // ниже. Пустым массивом набор не обнуляется: min(1) на уровне схемы роута.
  performer_ids?: string[];
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

  const performerIds =
    input.performer_ids !== undefined
      ? dedupePerformerIds(input.performer_ids)
      : undefined;
  // Инвариант «основной = первый в наборе» держится здесь, а не только в роуте:
  // сервис не должен зависеть от того, довёл ли его вызывающий.
  const performerId =
    input.performer_id !== undefined ? input.performer_id : performerIds?.[0];

  const setWorkType = input.work_type_id !== undefined;
  const setPerformer = performerId !== undefined;
  const setPerformerIds = performerIds !== undefined;
  const setWorkAssignment = input.work_assignment_id !== undefined;
  const setDescription = input.description !== undefined;
  const setTakenAt = input.taken_at !== undefined;
  const setPlan = input.plan_id !== undefined;

  if (
    !setWorkType &&
    !setPerformer &&
    !setPerformerIds &&
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      // Текущие значения нужны, чтобы отличить «переключение на архивную
      // позицию» (запрещено) от «поле прислали без изменений» (разрешено).
      // Старые клиенты шлют в PATCH все поля, поэтому отвергать любой
      // неактивный id нельзя — сломается редактирование истории.
      // FOR UPDATE сериализует конкурентные правки этого отчёта: снятое ниже
      // состояние связки должно относиться к тому же моменту, что и эта строка.
      const cur = await client.query<{
        work_type_id: string;
        work_assignment_id: string | null;
        performer_id: string;
      }>(
        `SELECT work_type_id, work_assignment_id, performer_id
           FROM reports WHERE id = $1 FOR UPDATE`,
        [input.id],
      );
      if (cur.rowCount === 0) {
        throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
      }
      const current = cur.rows[0];

      // Число связей ДО UPDATE. Считать после нельзя: триггер
      // sync_report_primary_performer срабатывает AFTER UPDATE OF performer_id и
      // немедленно добавляет новую связь, из-за чего одиночный отчёт выглядел бы
      // как многоисполнительский и уходил в аддитивную ветку вместо замены.
      const cntBefore = await client.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM report_performers WHERE report_id = $1`,
        [input.id],
      );
      const performerCountBefore = Number(cntBefore.rows[0]?.cnt ?? '0');

      if (setWorkType && input.work_type_id !== current.work_type_id) {
        await assertDictActiveForWrite(client, 'work_types', input.work_type_id!);
      }
      if (
        setWorkAssignment &&
        input.work_assignment_id &&
        input.work_assignment_id !== current.work_assignment_id
      ) {
        await assertDictActiveForWrite(
          client,
          'work_assignments',
          input.work_assignment_id,
        );
      }

      // expectedUpdatedAt передаётся как text — сравниваем после cast в timestamptz
      // на стороне Postgres, чтобы не терять микросекунды через JS Date.
      // Клиент хранит исходную строку из ответа сервера (db.ts → setTypeParser).
      const result = await client.query<{ id: string }>(
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
          setPerformer ? performerId : null,
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

      // Решение по связке принимается по состоянию ДО UPDATE.
      //
      // Наивное правило «нет performer_ids → набор из одного элемента» превратило
      // бы отчёт [A, B] в [A] при правке одного лишь описания: старый клиент шлёт
      // performer_id в КАЖДОМ PATCH (src/services/sync.ts, report_update).
      if (setPerformerIds) {
        // Клиент умеет множественность — заменяем набор целиком.
        await client.query(
          `DELETE FROM report_performers
            WHERE report_id = $1 AND performer_id <> ALL($2::uuid[])`,
          [input.id, performerIds],
        );
        await client.query(
          `INSERT INTO report_performers (report_id, performer_id)
           SELECT $1::uuid, unnest($2::uuid[])
           ON CONFLICT DO NOTHING`,
          [input.id, performerIds],
        );
      } else if (setPerformer && performerId !== current.performer_id) {
        // Старый клиент сменил основного исполнителя. Триггер уже добавил новую
        // связь; остаётся решить судьбу прежних.
        if (performerCountBefore <= 1) {
          // Отчёт был одиночным — прежняя семантика «замена» сохраняется.
          await client.query(
            `DELETE FROM report_performers
              WHERE report_id = $1 AND performer_id <> $2::uuid`,
            [input.id, performerId],
          );
        }
        // Иначе — аддитивно: старый клиент не умеет выражать множественность,
        // и только добавление ничего не теряет. Триггер уже всё сделал.
      }
      // Ни performer_ids, ни смены performer_id — связку не трогаем.

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof AppError) throw err;
      mapPgError(err, {
        foreignKeyViolation: {
          code: 'FK_VIOLATION',
          message: 'Связанные данные не найдены.',
        },
      });
    }
  } finally {
    client.release();
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
  // Выделенный клиент, а не pool.query: на пуле каждый вызов может достаться
  // разному соединению, и BEGIN/COMMIT оказались бы в разных транзакциях.
  const client = await pool.connect();
  try {
    // ON CONFLICT (report_id) опирается на обычный уникальный индекс
    // report_plan_marks_report_uniq — он намеренно оставлен нетронутым, чтобы
    // старые клиенты продолжали работать после миграции с точками фотографий.
    // Сдвиг updated_at в той же транзакции: на него смотрит reconcile, иначе
    // правка легаси-метки осталась бы незамеченной другими устройствами.
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO report_plan_marks (id, report_id, plan_id, page, x_norm, y_norm)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       ON CONFLICT (report_id) DO UPDATE
         SET plan_id = EXCLUDED.plan_id,
             page    = EXCLUDED.page,
             x_norm  = EXCLUDED.x_norm,
             y_norm  = EXCLUDED.y_norm`,
      [input.reportId, input.plan_id, input.page, input.x_norm, input.y_norm],
    );
    await client.query(`UPDATE reports SET updated_at = now() WHERE id = $1`, [
      input.reportId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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
  } finally {
    client.release();
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Только легаси-таблица: точки фотографий живут в report_photo_plan_marks
    // и остаются нетронутыми. Иначе откат API уничтожал бы их.
    await client.query(`DELETE FROM report_plan_marks WHERE report_id = $1`, [
      input.reportId,
    ]);
    await client.query(`UPDATE reports SET updated_at = now() WHERE id = $1`, [
      input.reportId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// --- точки фотографий (report_photo_plan_marks) ------------------------------

export interface PhotoPlanMarkInput {
  photo_id: string;
  plan_id: string;
  page: number;
  x_norm: number;
  y_norm: number;
}

/** Тот же критерий, что и в src/shared/lib/isPanorama.ts на клиенте. */
function isPanoramaByRatio(
  width: number | null,
  height: number | null,
): boolean {
  if (!width || !height || height <= 0) return false;
  if (width < 1024) return false;
  return Math.abs(width / height - 2) < 0.03;
}

/**
 * Полная замена набора точек фотографий отчёта.
 *
 * Replace-all, а не операция на точку: очередь синхронизации держит одну
 * операцию `mark` на отчёт, и так эта модель сохраняется — не нужно заводить
 * идентичность каждой точки в очереди.
 *
 * OCC идёт по отдельной `reports.photo_marks_version`, а НЕ по updated_at:
 * в офлайн-батче report_update сдвигает updated_at, и следующий за ним
 * mark_update получил бы 409 от собственной же предыдущей операции.
 */
export async function setPhotoPlanMarks(input: {
  user: AuthenticatedUser;
  reportId: string;
  marks: PhotoPlanMarkInput[];
  expectedMarksVersion: string | null;
}): Promise<{ ok: true; photo_marks_version: string }> {
  const access = await loadReportForAccess(input.reportId);
  if (!access) {
    throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
  }
  assertReportEditable(input.user, access);

  // Дубли схлопываются, первое вхождение выигрывает: отказ превратил бы
  // sync-операцию в вечно падающую и заблокировал бы черновик на устройстве.
  const seen = new Set<string>();
  const marks = input.marks.filter((m) => {
    if (seen.has(m.photo_id)) return false;
    seen.add(m.photo_id);
    return true;
  });

  // Планы проверяем до транзакции: запрос независимый и не держит блокировку.
  for (const planId of new Set(marks.map((m) => m.plan_id))) {
    await assertPlanInProject(planId, access.project_id);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      // FOR UPDATE сериализует конкурентные замены набора.
      const cur = await client.query<{ photo_marks_version: string }>(
        `SELECT photo_marks_version::text AS photo_marks_version
           FROM reports WHERE id = $1 FOR UPDATE`,
        [input.reportId],
      );
      if (cur.rowCount === 0) {
        throw new AppError(404, 'NOT_FOUND', 'Отчёт не найден.');
      }
      const currentVersion = cur.rows[0].photo_marks_version;

      // OCC проверяется ПЕРВЫМ — до любых удалений и вставок.
      if (
        input.expectedMarksVersion !== null &&
        input.expectedMarksVersion !== currentVersion
      ) {
        throw new AppError(
          409,
          'CONFLICT',
          'Точки на плане были изменены другим пользователем. Обновите данные и повторите.',
        );
      }

      if (marks.length > 0) {
        // Фото должно принадлежать этому отчёту и быть сферическим.
        const photos = await client.query<{
          id: string;
          width: number | null;
          height: number | null;
        }>(
          `SELECT id, width, height FROM report_photos
            WHERE report_id = $1 AND id = ANY($2::uuid[])`,
          [input.reportId, marks.map((m) => m.photo_id)],
        );
        const byId = new Map(photos.rows.map((p) => [p.id, p]));

        for (const m of marks) {
          const photo = byId.get(m.photo_id);
          if (!photo) {
            // Отдельный код вместо FK_VIOLATION: тот классифицируется как
            // permanent, и операция была бы удалена вместе с точками, хотя
            // фотография просто ещё не догрузилась в S3.
            throw new AppError(
              409,
              'PHOTO_NOT_SYNCED',
              'Фотография ещё не синхронизирована — точка будет отправлена позже.',
              { photoId: m.photo_id },
            );
          }
          // width/height могут быть неизвестны у старых записей: тогда не
          // отвергаем, доказать «не панорама» нечем.
          if (
            photo.width !== null &&
            photo.height !== null &&
            !isPanoramaByRatio(photo.width, photo.height)
          ) {
            throw new AppError(
              422,
              'NOT_PANORAMA',
              'Точку на плане можно поставить только сферическому (360°) снимку.',
              { photoId: m.photo_id },
            );
          }
        }

        await assertPlanPagesExist(client, marks);
      }

      await client.query(
        `DELETE FROM report_photo_plan_marks
          WHERE report_id = $1 AND photo_id <> ALL($2::uuid[])`,
        [input.reportId, marks.map((m) => m.photo_id)],
      );

      for (const m of marks) {
        await client.query(
          `INSERT INTO report_photo_plan_marks
                 (report_id, photo_id, plan_id, page, x_norm, y_norm)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (photo_id) DO UPDATE
             SET plan_id = EXCLUDED.plan_id,
                 page    = EXCLUDED.page,
                 x_norm  = EXCLUDED.x_norm,
                 y_norm  = EXCLUDED.y_norm`,
          [input.reportId, m.photo_id, m.plan_id, m.page, m.x_norm, m.y_norm],
        );
      }

      // Инкремент версии + сдвиг updated_at триггером: на updated_at
      // опирается reconcile, иначе он не заметит смены точек.
      const bumped = await client.query<{ photo_marks_version: string }>(
        `UPDATE reports SET photo_marks_version = photo_marks_version + 1
          WHERE id = $1
        RETURNING photo_marks_version::text AS photo_marks_version`,
        [input.reportId],
      );
      await client.query('COMMIT');
      return { ok: true, photo_marks_version: bumped.rows[0].photo_marks_version };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof AppError) throw err;
      mapPgError(err, {
        foreignKeyViolation: {
          code: 'FK_VIOLATION',
          message: 'План или фотография не найдены.',
        },
        checkViolation: {
          code: 'CHECK_VIOLATION',
          message: 'Координаты точки должны быть в диапазоне [0, 1].',
        },
      });
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Страница не должна выходить за пределы плана, когда page_count известен. */
async function assertPlanPagesExist(
  client: PoolClient,
  marks: PhotoPlanMarkInput[],
): Promise<void> {
  const rows = await client.query<{ id: string; page_count: number | null }>(
    `SELECT id, page_count FROM plans WHERE id = ANY($1::uuid[])`,
    [[...new Set(marks.map((m) => m.plan_id))]],
  );
  const byId = new Map(rows.rows.map((p) => [p.id, p.page_count]));
  for (const m of marks) {
    const count = byId.get(m.plan_id);
    if (count != null && m.page > count) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Страница ${m.page} выходит за пределы плана (${count}).`,
      );
    }
  }
}
