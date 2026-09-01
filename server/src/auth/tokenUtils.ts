import { randomBytes, createHash } from 'node:crypto';

/**
 * Общая крипта для одноразовых токенов: refresh-сессии и ссылки сброса пароля.
 *
 * Сырой токен не хранится нигде — в БД лежит только sha256-хэш, поэтому утечка
 * дампа не даёт возможности предъявить токен.
 */

/** 256 бит энтропии; base64url безопасен и для URL, и для заголовков. */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
