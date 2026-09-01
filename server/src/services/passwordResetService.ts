import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { SessionEnvelope } from '../http/responses.js';
import { hashPassword } from '../auth/passwords.js';
import { validateNewPassword } from '../auth/passwordPolicy.js';
import { generateRawToken, hashToken } from '../auth/tokenUtils.js';
import {
  revokeAllForUser,
  type IssueContext,
} from '../auth/refreshTokens.js';
import {
  buildEnvelopeWithTokens,
  profileFromRow,
  type ProfileRow,
} from './authService.js';

/** Ссылка живёт сутки: достаточно, чтобы админ успел передать её вне приложения. */
const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Пауза между повторными заявками одного пользователя. Заодно не даёт спамом
 * гасить ссылку, которую админ только что выдал.
 */
const REQUEST_COOLDOWN = '15 minutes';

export type PasswordResetStatus = 'pending' | 'issued' | 'used' | 'cancelled';

export interface PasswordResetRequestDTO {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: PasswordResetStatus;
  source: 'user' | 'admin';
  requested_at: string;
  last_requested_at: string;
  request_count: number;
  token_issued_at: string | null;
  token_expires_at: string | null;
  /** Ссылка выдана, но её срок уже вышел. Для очереди это закрытая позиция. */
  link_expired: boolean;
  used_at: string | null;
  cancelled_at: string | null;
}

interface RequestRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: PasswordResetStatus;
  source: 'user' | 'admin';
  requested_at: Date;
  last_requested_at: Date;
  request_count: number;
  token_issued_at: Date | null;
  token_expires_at: Date | null;
  link_expired: boolean;
  used_at: Date | null;
  cancelled_at: Date | null;
}

function toDTO(row: RequestRow): PasswordResetRequestDTO {
  return {
    id: row.id,
    user_id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    status: row.status,
    source: row.source,
    requested_at: row.requested_at.toISOString(),
    last_requested_at: row.last_requested_at.toISOString(),
    request_count: row.request_count,
    token_issued_at: row.token_issued_at?.toISOString() ?? null,
    token_expires_at: row.token_expires_at?.toISOString() ?? null,
    link_expired: row.link_expired,
    used_at: row.used_at?.toISOString() ?? null,
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
  };
}

const SELECT_DTO = `
  SELECT r.id, r.user_id, au.email::text AS email, p.full_name,
         r.status, r.source, r.requested_at, r.last_requested_at,
         r.request_count, r.token_issued_at, r.token_expires_at,
         (r.status = 'issued' AND r.token_expires_at <= now()) AS link_expired,
         r.used_at, r.cancelled_at
    FROM password_reset_requests r
    JOIN app_users au ON au.id = r.user_id
    LEFT JOIN profiles p ON p.id = r.user_id`;

/**
 * Маскирует адрес: держатель ссылки и так владеет доступом, но она ходит
 * мессенджерами и может осесть в групповом чате. Число звёздочек фиксировано,
 * чтобы не выдавать длину.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, Math.min(2, local.length))}****@${domain}`;
}

// ---------- заявка пользователя ----------

/**
 * Публичная заявка на сброс.
 *
 * Ничего не возвращает и никогда не сообщает, найден ли адрес: роут при любом
 * исходе отвечает одинаково, иначе форма превращается в проверялку
 * зарегистрированных адресов. Bcrypt здесь не вызывается ни в одной ветке —
 * обе это один индексный SELECT, так что и тайминг не различается.
 */
export async function requestPasswordReset(
  email: string,
  ctx: IssueContext = {},
): Promise<void> {
  const normalized = email.trim().toLowerCase();

  const userResult = await pool.query<{ id: string }>(
    `SELECT id FROM app_users WHERE email = $1 AND deleted_at IS NULL`,
    [normalized],
  );
  // Неактивный профиль заявку создаёт: активация и восстановление доступа —
  // разные вещи.
  if (userResult.rowCount === 0) return;

  await pool.query(
    `INSERT INTO password_reset_requests
            (user_id, status, source, request_ip, request_user_agent)
     VALUES ($1, 'pending', 'user', $2, $3)
     ON CONFLICT (user_id) WHERE status IN ('pending','issued')
     DO UPDATE SET
       -- Повторная заявка поверх уже выданной ссылки гасит её: сырой токен
       -- админ второй раз показать не может, поэтому строка возвращается в
       -- очередь как новая заявка.
       status             = 'pending',
       source             = 'user',
       token_hash         = NULL,
       token_issued_at    = NULL,
       token_expires_at   = NULL,
       issued_by          = NULL,
       last_requested_at  = now(),
       request_count      = password_reset_requests.request_count + 1,
       request_ip         = EXCLUDED.request_ip,
       request_user_agent = EXCLUDED.request_user_agent
     WHERE password_reset_requests.last_requested_at
             < now() - interval '${REQUEST_COOLDOWN}'`,
    [userResult.rows[0].id, ctx.ip ?? null, ctx.userAgent ?? null],
  );
}

// ---------- выдача ссылки администратором ----------

export interface IssuedResetLink {
  request: PasswordResetRequestDTO;
  token: string;
}

export async function issueResetLink(
  userId: string,
  adminId: string,
): Promise<IssuedResetLink> {
  const exists = await pool.query(
    `SELECT id FROM app_users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (exists.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Пользователь не найден.');
  }

  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  // Один upsert покрывает все случаи: создать заявку, прицепить ссылку к
  // существующей, перевыпустить поверх живой или истёкшей.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO password_reset_requests
            (user_id, status, source, request_count,
             token_hash, token_issued_at, token_expires_at, issued_by)
     VALUES ($1, 'issued', 'admin', 0, $2, now(), $3, $4)
     ON CONFLICT (user_id) WHERE status IN ('pending','issued')
     DO UPDATE SET
       status           = 'issued',
       token_hash       = EXCLUDED.token_hash,
       token_issued_at  = EXCLUDED.token_issued_at,
       token_expires_at = EXCLUDED.token_expires_at,
       issued_by        = EXCLUDED.issued_by
     RETURNING id`,
    [userId, hashToken(rawToken), expiresAt, adminId],
  );

  const dto = await fetchRequest(inserted.rows[0].id);
  return { request: dto, token: rawToken };
}

async function fetchRequest(id: string): Promise<PasswordResetRequestDTO> {
  const result = await pool.query<RequestRow>(`${SELECT_DTO} WHERE r.id = $1`, [
    id,
  ]);
  if (result.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Заявка не найдена.');
  }
  return toDTO(result.rows[0]);
}

export async function listResetRequests(): Promise<PasswordResetRequestDTO[]> {
  const result = await pool.query<RequestRow>(
    `${SELECT_DTO}
      WHERE au.deleted_at IS NULL
        AND (r.status IN ('pending','issued')
             OR r.updated_at > now() - interval '30 days')
      ORDER BY (r.status IN ('pending','issued')
                AND (r.token_expires_at IS NULL OR r.token_expires_at > now())) DESC,
               r.last_requested_at DESC
      LIMIT 200`,
  );
  return result.rows.map(toDTO);
}

export async function cancelResetRequest(
  id: string,
  adminId: string,
): Promise<PasswordResetRequestDTO> {
  // Условный апдейт атомарен сам по себе; гонку с confirm разруливает его
  // FOR UPDATE на этой же строке.
  const result = await pool.query<{ id: string }>(
    `UPDATE password_reset_requests
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
      WHERE id = $1 AND status IN ('pending','issued')
      RETURNING id`,
    [id, adminId],
  );
  if (result.rowCount === 0) {
    throw new AppError(
      409,
      'RESET_ALREADY_CLOSED',
      'Заявка уже закрыта. Обновите список.',
    );
  }
  return fetchRequest(id);
}

// ---------- проверка и подтверждение ----------

interface TokenRow {
  id: string;
  user_id: string;
  status: PasswordResetStatus;
  token_expires_at: Date | null;
}

/** Классификация состояния ссылки. Общая для check и confirm. */
function assertUsable(row: TokenRow | undefined): asserts row is TokenRow {
  if (!row || row.status === 'cancelled') {
    throw new AppError(
      404,
      'RESET_TOKEN_INVALID',
      'Ссылка недействительна. Запросите новую у администратора.',
    );
  }
  if (row.status === 'used') {
    throw new AppError(
      410,
      'RESET_TOKEN_USED',
      'Ссылка уже использована. Если это были не вы — обратитесь к администратору.',
    );
  }
  if (!row.token_expires_at || row.token_expires_at.getTime() <= Date.now()) {
    throw new AppError(
      410,
      'RESET_TOKEN_EXPIRED',
      'Срок действия ссылки истёк — она действовала 24 часа. Запросите новую.',
    );
  }
}

export interface ResetTokenInfo {
  email_masked: string;
  expires_at: string;
}

/**
 * Проверка ссылки перед показом формы.
 *
 * ЧИСТЫЙ SELECT: ничего не мутирует и не расходует токен. Иначе превью
 * мессенджера или антивирусный сканер ссылок гасили бы её до того, как
 * пользователь успеет открыть страницу.
 */
export async function checkResetToken(token: string): Promise<ResetTokenInfo> {
  const result = await pool.query<TokenRow & { email: string }>(
    `SELECT r.id, r.user_id, r.status, r.token_expires_at, au.email::text AS email
       FROM password_reset_requests r
       JOIN app_users au ON au.id = r.user_id
      WHERE r.token_hash = $1 AND au.deleted_at IS NULL`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  assertUsable(row);

  return {
    email_masked: maskEmail(row.email),
    // token_expires_at гарантированно не null: assertUsable это проверил.
    expires_at: row.token_expires_at!.toISOString(),
  };
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  ctx: IssueContext = {},
): Promise<SessionEnvelope> {
  validateNewPassword(newPassword);

  // bcrypt (~250 мс) считаем ДО транзакции: держать на нём блокировку строки
  // и коннект пула нельзя. Заодно тайминг валидного и невалидного токена
  // выравнивается.
  const nextHash = await hashPassword(newPassword);
  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE делает двойной сабмит (две вкладки, дабл-тап на телефоне)
    // детерминированным: второй ждёт и читает уже status = 'used'.
    const found = await client.query<TokenRow>(
      `SELECT id, user_id, status, token_expires_at
         FROM password_reset_requests
        WHERE token_hash = $1
          FOR UPDATE`,
      [tokenHash],
    );
    const row = found.rows[0];
    assertUsable(row);

    const userResult = await client.query<{
      id: string;
      email: string;
      password_hash: string | null;
    }>(
      `SELECT id, email::text AS email, password_hash
         FROM app_users
        WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
      [row.user_id],
    );
    if (userResult.rowCount === 0) {
      // Аккаунт удалили между выдачей ссылки и её использованием.
      throw new AppError(
        404,
        'RESET_TOKEN_INVALID',
        'Ссылка недействительна. Запросите новую у администратора.',
      );
    }
    const user = userResult.rows[0];

    await client.query(
      `UPDATE password_reset_requests
          SET status = 'used', used_at = now(), used_ip = $2
        WHERE id = $1`,
      [row.id, ctx.ip ?? null],
    );

    // Подстраховка: частичный уникальный индекс и так держит не больше одной
    // открытой заявки, но если она всё же появится — закрываем.
    await client.query(
      `UPDATE password_reset_requests
          SET status = 'cancelled', cancelled_at = now()
        WHERE user_id = $1 AND id <> $2 AND status IN ('pending','issued')`,
      [user.id, row.id],
    );

    const updated = await client.query<{ session_version: number }>(
      `UPDATE app_users
          SET password_hash   = $1,
              session_version = session_version + 1
        WHERE id = $2 AND deleted_at IS NULL
      RETURNING session_version`,
      [nextHash, user.id],
    );
    if (updated.rowCount === 0) {
      throw new AppError(
        404,
        'RESET_TOKEN_INVALID',
        'Ссылка недействительна. Запросите новую у администратора.',
      );
    }
    const sessionVersion = updated.rows[0].session_version;

    const profileResult = await client.query<ProfileRow>(
      `SELECT id, full_name, role, is_active FROM profiles WHERE id = $1`,
      [user.id],
    );
    if (profileResult.rowCount === 0) {
      throw new AppError(
        500,
        'PROFILE_MISSING',
        'Профиль пользователя отсутствует.',
      );
    }
    const profile = profileFromRow(profileResult.rows[0]);

    // Смысл сброса часто в том, что доступ мог быть у постороннего: гасим все
    // устройства. last_login_at не трогаем — сброс это не вход.
    await revokeAllForUser(user.id, client);

    const envelope = await buildEnvelopeWithTokens(
      client,
      { id: user.id, email: user.email },
      profile,
      ctx,
      true,
      sessionVersion,
    );

    await client.query('COMMIT');
    return envelope;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // транзакция уже могла свернуться — исходную ошибку это не меняет
    }
    throw err;
  } finally {
    client.release();
  }
}
