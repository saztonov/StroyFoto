import { AppError } from '../http/errors.js';

/**
 * Единая проверка нового пароля для register, changePassword и
 * confirmPasswordReset.
 *
 * Почему не zod-схемой в роутах: локальный parseBody в routes/auth.ts
 * схлопывает любую ошибку схемы в VALIDATION_ERROR, поэтому код WEAK_PASSWORD
 * до клиента никогда бы не дошёл, а строка errors.weakPassword в ru.ts так и
 * осталась бы мёртвой. Схемы оставлены как дешёвый DoS-guard по длине.
 */

export const PASSWORD_MIN_LENGTH = 6;

/**
 * bcrypt (включая bcryptjs) обрабатывает только первые 72 БАЙТА пароля и
 * молча игнорирует остаток. Без явной границы два разных пароля с одинаковым
 * началом считались бы одним и тем же — поэтому длинный пароль честно
 * отвергаем, а не обрезаем.
 */
export const PASSWORD_MAX_BYTES = 72;

export function validateNewPassword(raw: string): void {
  if (raw.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(
      400,
      'WEAK_PASSWORD',
      `Пароль слишком короткий. Минимум ${PASSWORD_MIN_LENGTH} символов.`,
    );
  }

  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new AppError(
      400,
      'PASSWORD_TOO_LONG',
      `Пароль слишком длинный: не более ${PASSWORD_MAX_BYTES} байт — ` +
        'примерно 72 латинских или 36 кириллических символов.',
    );
  }
}
