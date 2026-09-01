import { getDB, type RetentionSetting } from '@/lib/db'

const RETENTION_KEY = 'retention'
const DEFAULT_RETENTION: RetentionSetting = { mode: 'all' }

export async function getRetention(): Promise<RetentionSetting> {
  const db = await getDB()
  const rec = await db.get('device_settings', RETENTION_KEY)
  if (!rec) return DEFAULT_RETENTION
  const v = rec.value as RetentionSetting | undefined
  if (!v || !v.mode) return DEFAULT_RETENTION
  return v
}

export async function setRetention(value: RetentionSetting): Promise<void> {
  const db = await getDB()
  await db.put('device_settings', { key: RETENTION_KEY, value })
}

/**
 * Кто последним владел локальными данными на этом устройстве.
 *
 * Нужен для cross-user wipe. Полагаться на «есть ли сейчас сессия» нельзя:
 * teardown() после 401 обнуляет состояние провайдера, но отчёты и фото
 * прежнего пользователя остаются в IDB, а после перезагрузки страницы и
 * previousUserId в памяти пуст. Поэтому владелец данных фиксируется отдельно
 * и переживает и разлогин, и перезагрузку.
 *
 * Запись НЕ удаляется ни при выходе, ни при wipe: она описывает, чьи данные
 * лежали на устройстве, а не текущую сессию.
 */
const LAST_USER_KEY = 'last_user_id'

export async function getLastUserId(): Promise<string | null> {
  try {
    const db = await getDB()
    const rec = await db.get('device_settings', LAST_USER_KEY)
    const v = rec?.value
    return typeof v === 'string' && v ? v : null
  } catch {
    // IDB недоступна — считаем, что владельца не знаем
    return null
  }
}

export async function setLastUserId(userId: string): Promise<void> {
  const db = await getDB()
  await db.put('device_settings', { key: LAST_USER_KEY, value: userId })
}
