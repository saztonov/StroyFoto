import { getDB, type AuthSessionRecord } from '@/lib/db'

/**
 * Хранилище refresh-токена. Access-токен НЕ персистится (XSS-резистентность),
 * он живёт только в памяти `apiClient`.
 *
 * Два режима в зависимости от чекбокса «Запомнить меня» на форме логина:
 *  - persistent: true   → запись в IndexedDB (auth_session), сессия переживает
 *                         закрытие браузера и действует до refreshExpiresAt.
 *  - persistent: false  → запись в sessionStorage, чистится автоматически
 *                         при закрытии вкладки/окна (per-tab).
 *
 * sessionStorage побеждает IDB при чтении: если в текущей сессии браузера
 * уже есть актуальная запись, она актуальнее старой персистентной.
 */

const SS_KEY = 'stroyfoto:auth_session'

export async function saveAuthSession(input: {
  userId: string
  email: string
  refreshToken: string
  refreshExpiresAt: number
  persistent: boolean
}): Promise<void> {
  const record: AuthSessionRecord = {
    key: 'session',
    userId: input.userId,
    email: input.email,
    refreshToken: input.refreshToken,
    refreshExpiresAt: input.refreshExpiresAt,
    savedAt: Date.now(),
    persistent: input.persistent,
  }
  if (input.persistent) {
    try {
      sessionStorage.removeItem(SS_KEY)
    } catch {
      // sessionStorage может быть недоступен (приватный режим/SSR) — игнорим
    }
    const db = await getDB()
    await db.put('auth_session', record)
  } else {
    try {
      const db = await getDB()
      await db.delete('auth_session', 'session')
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(record))
    } catch {
      // ignore
    }
  }
}

export async function loadAuthSession(): Promise<AuthSessionRecord | null> {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AuthSessionRecord
      if (parsed && parsed.refreshToken) return parsed
    }
  } catch {
    // ignore
  }
  try {
    const db = await getDB()
    const row = await db.get('auth_session', 'session')
    return row ?? null
  } catch {
    return null
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    sessionStorage.removeItem(SS_KEY)
  } catch {
    // ignore
  }
  try {
    const db = await getDB()
    await db.delete('auth_session', 'session')
  } catch {
    // ignore
  }
}
