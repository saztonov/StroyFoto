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
  // Все SELECT'ы для словарей кастят created_at::text — pg-driver иначе
  // конвертирует в Date. Это не критично для UI, но единообразие с
  // reports/photos упрощает клиент (везде ISO-string).
  created_at: string;
}

function toDictDTO(row: NamedDictRow): NamedDictDTO {
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function tableExpr(kind: 'work_types' | 'work_assignments'): string {
  return kind;
}

function dictLabel(kind: 'work_types' | 'work_assignments'): string {
  return kind === 'work_types' ? 'Вид работ' : 'Назначение работ';
}

/**
 * Архивная (is_active = false) позиция не может быть выбрана заново — иначе
 * деактивация обходится вводом точного имени, и справочник продолжает
 * засоряться. Историческую ссылку в уже существующем отчёте это не трогает:
 * там проверка идёт по «значение не изменилось» (см. reportsService).
 */
function assertDictActive(
  kind: 'work_types' | 'work_assignments',
  row: NamedDictRow,
): NamedDictDTO {
  if (!row.is_active) {
    throw new AppError(
      409,
      'DICT_INACTIVE',
      `${dictLabel(kind)} «${row.name}» отключён администратором. Выберите другой.`,
      { catalogKind: singularKind(kind), catalogId: row.id },
    );
  }
  return toDictDTO(row);
}

/** Клиент оперирует единственным числом ('work_type'), сервер — именем таблицы. */
function singularKind(kind: 'work_types' | 'work_assignments'): string {
  return kind === 'work_types' ? 'work_type' : 'work_assignment';
}

export async function listActiveDict(
  kind: 'work_types' | 'work_assignments',
): Promise<NamedDictDTO[]> {
  const result = await pool.query<NamedDictRow>(
    `SELECT id, name::text AS name, is_active, created_by, created_at::text AS created_at
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
    `SELECT id, name::text AS name, is_active, created_by, created_at::text AS created_at
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
 *
 * `allowCreate` = false (не админ) превращает функцию в РЕЗОЛВЕР: существующую
 * активную позицию она вернёт, новую не создаст. Именно резолвер, а не запрет
 * на уровне роута — потому что этот же endpoint сливает офлайн-очередь,
 * накопленную до блокировки. Если админ тем временем завёл позицию с тем же
 * именем, черновик самоисцелится через remap на клиенте; жёсткий 403 на любой
 * запрос вместо этого потерял бы зависимый отчёт.
 *
 * Проверка is_active стоит на ВСЕХ трёх путях поиска (по id, по имени и в
 * race-ветке) — иначе деактивация обходится через любой из непокрытых.
 */
export async function upsertDictPublic(input: {
  kind: 'work_types' | 'work_assignments';
  id: string | null;
  name: string;
  createdBy: string;
  allowCreate: boolean;
}): Promise<NamedDictDTO> {
  const name = input.name.trim();
  if (!name) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Название не может быть пустым.');
  }

  // Try by id first if provided.
  if (input.id) {
    const existing = await pool.query<NamedDictRow>(
      `SELECT id, name::text AS name, is_active, created_by, created_at::text AS created_at
         FROM ${tableExpr(input.kind)} WHERE id = $1`,
      [input.id],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return assertDictActive(input.kind, existing.rows[0]);
    }
  }

  // Try by name (citext unique).
  const byName = await pool.query<NamedDictRow>(
    `SELECT id, name::text AS name, is_active, created_by, created_at::text AS created_at
       FROM ${tableExpr(input.kind)} WHERE name = $1`,
    [name],
  );
  if (byName.rowCount && byName.rowCount > 0) {
    return assertDictActive(input.kind, byName.rows[0]);
  }

  if (!input.allowCreate) {
    throw new AppError(
      403,
      'DICT_CREATE_FORBIDDEN',
      `Новые позиции справочника «${dictLabel(input.kind)}» добавляет администратор.`,
      // id здесь — это клиентский UUID черновика: именно он лежит в
      // work_types_local и в reports.workTypeId у зависимых отчётов.
      { catalogKind: singularKind(input.kind), catalogId: input.id },
    );
  }

  try {
    const result = await pool.query<NamedDictRow>(
      `INSERT INTO ${tableExpr(input.kind)} (id, name, is_active, created_by)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, true, $3)
       RETURNING id, name::text AS name, is_active, created_by, created_at::text AS created_at`,
      [input.id, name, input.createdBy],
    );
    return toDictDTO(result.rows[0]);
  } catch (err) {
    // Race: select again.
    const races = await pool.query<NamedDictRow>(
      `SELECT id, name::text AS name, is_active, created_by, created_at::text AS created_at
         FROM ${tableExpr(input.kind)} WHERE name = $1`,
      [name],
    );
    if (races.rowCount && races.rowCount > 0) {
      return assertDictActive(input.kind, races.rows[0]);
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
       RETURNING id, name::text AS name, is_active, created_by, created_at::text AS created_at`,
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
        RETURNING id, name::text AS name, is_active, created_by, created_at::text AS created_at`,
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

function reportsFkColumn(kind: 'work_types' | 'work_assignments'): string {
  return kind === 'work_types' ? 'work_type_id' : 'work_assignment_id';
}

/**
 * Физическое удаление позиции справочника — только если на неё не ссылается ни
 * один отчёт.
 *
 * Проверку делаем явно, а не полагаемся на FK: у справочников разные правила и
 * защищает только один из них.
 *   reports.work_type_id        → ON DELETE RESTRICT — база откажет сама;
 *   reports.work_assignment_id  → ON DELETE SET NULL — база РАЗРЕШИТ удаление
 *                                 и молча обнулит назначение в отчётах.
 * Поэтому условие `NOT EXISTS` — единственное, что оберегает назначения работ.
 * Оно в одном statement с DELETE, так что гонки с параллельной вставкой отчёта
 * нет: конкурирующая вставка берёт FOR KEY SHARE на ту же строку.
 *
 * Остаётся риск, которого БД не видит в принципе: офлайн-устройство могло
 * сохранить черновик отчёта со ссылкой на эту позицию, и ноль ссылок в проде
 * его не исключает. После удаления такой черновик при синхронизации не найдёт
 * позицию, получит DICT_CREATE_FORBIDDEN и уйдёт в статус blocked с предложением
 * выбрать замену — данные не теряются, но пользователю придётся вмешаться.
 * Поэтому штатный способ вывода из оборота — архив (is_active = false),
 * а удаление уместно для опечаток и мусорных записей.
 */
export async function deleteDictAdmin(input: {
  kind: 'work_types' | 'work_assignments';
  id: string;
}): Promise<void> {
  const table = tableExpr(input.kind);
  const fkColumn = reportsFkColumn(input.kind);

  try {
    const result = await pool.query(
      `DELETE FROM ${table} d
        WHERE d.id = $1
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.${fkColumn} = d.id)`,
      [input.id],
    );
    if (result.rowCount && result.rowCount > 0) {
      return;
    }
  } catch (err) {
    mapPgError(err, {
      foreignKeyViolation: {
        code: 'DICT_IN_USE',
        message:
          'Позиция используется в отчётах и не может быть удалена. Отключите её — она уйдёт в архив.',
      },
    });
  }

  // Ноль удалённых строк — либо позиции нет, либо она используется.
  const still = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [
    input.id,
  ]);
  if (still.rowCount && still.rowCount > 0) {
    throw new AppError(
      409,
      'DICT_IN_USE',
      'Позиция используется в отчётах и не может быть удалена. Отключите её — она уйдёт в архив.',
    );
  }
  throw new AppError(404, 'NOT_FOUND', 'Запись не найдена.');
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
      RETURNING id, name::text AS name, is_active, created_by, created_at::text AS created_at`,
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
  // pg-types для timestamptz: raw-string (см. db.ts).
  created_at: string;
}

function toPerformerDTO(row: PerformerRow): PerformerDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

export async function listActivePerformers(): Promise<PerformerDTO[]> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at::text AS created_at
       FROM performers
      WHERE is_active = true
      ORDER BY kind ASC, name ASC
      LIMIT 1000`,
  );
  return result.rows.map(toPerformerDTO);
}

export async function listAllPerformers(): Promise<PerformerDTO[]> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at::text AS created_at
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
       RETURNING id, name::text AS name, kind, is_active, created_at::text AS created_at`,
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
       RETURNING id, name::text AS name, kind, is_active, created_at::text AS created_at`,
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
     RETURNING id, name::text AS name, kind, is_active, created_at::text AS created_at`,
    [input.isActive, input.id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Исполнитель не найден.');
  }
  return toPerformerDTO(result.rows[0]);
}

export async function getPerformerById(id: string): Promise<PerformerDTO> {
  const result = await pool.query<PerformerRow>(
    `SELECT id, name::text AS name, kind, is_active, created_at::text AS created_at
       FROM performers WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Исполнитель не найден.');
  }
  return toPerformerDTO(result.rows[0]);
}
