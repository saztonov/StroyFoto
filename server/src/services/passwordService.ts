import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { SessionEnvelope } from '../http/responses.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { validateNewPassword } from '../auth/passwordPolicy.js';
import {
  revokeAllForUser,
  type IssueContext,
} from '../auth/refreshTokens.js';
import {
  buildEnvelopeWithTokens,
  profileFromRow,
  type ProfileRow,
} from './authService.js';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * Смена пароля залогиненным пользователем.
 *
 * Гасит ВСЕ сессии (и refresh-токены, и уже выданные access-JWT через рост
 * session_version) и тут же выдаёт новую — текущее устройство остаётся в
 * приложении, остальные получают 401 на первом же запросе.
 */
export async function changePassword(
  input: ChangePasswordInput,
  ctx: IssueContext = {},
): Promise<SessionEnvelope> {
  validateNewPassword(input.newPassword);

  const userResult = await pool.query<{
    id: string;
    email: string;
    password_hash: string | null;
  }>(
    `SELECT id, email::text AS email, password_hash
     FROM app_users
     WHERE id = $1 AND deleted_at IS NULL`,
    [input.userId],
  );
  if (userResult.rowCount === 0 || userResult.rows[0].password_hash === null) {
    throw new AppError(401, 'UNAUTHORIZED', 'Необходима авторизация.');
  }
  const user = userResult.rows[0];
  const currentHash = user.password_hash as string;

  // 400, а НЕ 401: на 401 apiFetch запускает прозрачный refresh, тот ротирует
  // refresh-токен и гасит старый — каждая опечатка в поле «текущий пароль»
  // дёргала бы ротацию и могла сломать параллельную вкладку. Код тоже свой:
  // INVALID_CREDENTIALS замаплен на «неверная почта или пароль», что
  // бессмысленно в модалке без поля email.
  if (!(await verifyPassword(input.currentPassword, currentHash))) {
    throw new AppError(
      400,
      'INVALID_CURRENT_PASSWORD',
      'Текущий пароль указан неверно.',
    );
  }

  // Сравниваем с хэшем, а не две строки между собой: так же ловится случай,
  // когда пароль совпадает, но введён в другой раскладке Unicode-нормализации.
  if (await verifyPassword(input.newPassword, currentHash)) {
    throw new AppError(
      409,
      'PASSWORD_SAME',
      'Новый пароль совпадает с текущим.',
    );
  }

  // bcrypt (~250 мс на cost 12) считаем ДО транзакции: держать на нём
  // блокировку строки и коннект пула нельзя.
  const nextHash = await hashPassword(input.newPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM app_users WHERE id = $1 FOR UPDATE', [
      user.id,
    ]);

    // CAS по старому хэшу: если параллельная смена уже прошла, наш апдейт не
    // должен молча её перезаписать.
    const updated = await client.query<{ session_version: number }>(
      `UPDATE app_users
          SET password_hash   = $1,
              session_version = session_version + 1
        WHERE id = $2 AND password_hash = $3 AND deleted_at IS NULL
      RETURNING session_version`,
      [nextHash, user.id, currentHash],
    );
    if (updated.rowCount === 0) {
      throw new AppError(
        409,
        'PASSWORD_CHANGED_CONCURRENTLY',
        'Пароль был изменён в другом окне. Начните заново.',
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

    await revokeAllForUser(user.id, client);

    // Новая сессия выпускается ПОСЛЕ массового отзыва — иначе он погасил бы и её.
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
