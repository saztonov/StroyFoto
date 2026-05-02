import { getDB, type AuthSessionRecord } from '@/lib/db'

/**
 * Хранилище refresh-токена. Access-токен НЕ персистится (XSS-резистентность),
 * он живёт только в памяти `apiClient`.
 */

export async function saveAuthSession(input: {
  userId: string
  email: string
  refreshToken: string
  refreshExpiresAt: number
}): Promise<void> {
  const db = await getDB()
  const record: AuthSessionRecord = {
    key: 'session',
    userId: input.userId,
    email: input.email,
    refreshToken: input.refreshToken,
    refreshExpiresAt: input.refreshExpiresAt,
    savedAt: Date.now(),
  }
  await db.put('auth_session', record)
}

export async function loadAuthSession(): Promise<AuthSessionRecord | null> {
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
    const db = await getDB()
    await db.delete('auth_session', 'session')
  } catch {
    // ignore
  }
}
