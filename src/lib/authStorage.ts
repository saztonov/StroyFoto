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
 *
 * ── Почему мутации сериализованы ──────────────────────────────────────────
 * Запись в IndexedDB асинхронна, поэтому «проверить, что сессия не сменилась,
 * и записать» — не атомарная пара. Без очереди зависший tryRefresh, начавший
 * запись до смены пароля, мог бы завершить её последним и затереть только что
 * выданный токен. Все мутации проходят через withSessionLock, а проверка
 * поколения (epoch) делается ВНУТРИ критической секции, непосредственно перед
 * записью.
 */

const SS_KEY = 'stroyfoto:auth_session'

/**
 * Поколение сессии. Растёт на каждой успешной мутации; операция, начатая при
 * старом поколении, свой результат уже не применяет.
 */
let sessionEpoch = 0

let chain: Promise<unknown> = Promise.resolve()

export function getSessionEpoch(): number {
  return sessionEpoch
}

/** Ставит операцию в общую очередь мутаций сессии. */
export function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  // Упавшая операция не должна обрывать очередь следующим за ней.
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export interface SaveAuthSessionInput {
  userId: string
  email: string
  refreshToken: string
  refreshExpiresAt: number
  persistent: boolean
}

/** Тело записи без блокировки — вызывать только изнутри withSessionLock. */
async function writeSession(input: SaveAuthSessionInput): Promise<void> {
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

/** Тело очистки без блокировки — вызывать только изнутри withSessionLock. */
async function wipeSession(): Promise<void> {
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

async function readSession(): Promise<AuthSessionRecord | null> {
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

/**
 * Безусловная запись сессии — логин, регистрация, сброс пароля. Всегда
 * побеждает конкурирующие операции.
 *
 * `input === null` означает «refresh-токена в ответе нет, меняется только
 * access» (так отвечает, например, /api/profile). `commit` см. в
 * saveAuthSessionIfCurrent.
 */
export function saveAuthSession(
  input: SaveAuthSessionInput | null,
  commit?: () => void,
): Promise<void> {
  return withSessionLock(async () => {
    if (input) await writeSession(input)
    commit?.()
    sessionEpoch++
  })
}

/**
 * Запись только если поколение не сменилось с момента expectedEpoch.
 *
 * `commit` выполняется ВНУТРИ критической секции: сюда передаётся установка
 * access-токена, чтобы запись в IDB и токен в памяти менялись атомарно. Иначе
 * два конкурирующих обновления могли бы переставиться местами и оставить
 * refresh-токен от одного, а access — от другого.
 *
 * @returns false, если сессию успели сменить и результат устарел.
 */
export function saveAuthSessionIfCurrent(
  input: SaveAuthSessionInput | null,
  expectedEpoch: number,
  commit?: () => void,
): Promise<boolean> {
  return withSessionLock(async () => {
    if (sessionEpoch !== expectedEpoch) return false
    if (input) await writeSession(input)
    commit?.()
    sessionEpoch++
    return true
  })
}

export function clearAuthSession(commit?: () => void): Promise<void> {
  return withSessionLock(async () => {
    await wipeSession()
    commit?.()
    sessionEpoch++
  })
}

/** Очистка только если поколение не сменилось. См. saveAuthSessionIfCurrent. */
export function clearAuthSessionIfCurrent(
  expectedEpoch: number,
  commit?: () => void,
): Promise<boolean> {
  return withSessionLock(async () => {
    if (sessionEpoch !== expectedEpoch) return false
    await wipeSession()
    commit?.()
    sessionEpoch++
    return true
  })
}

export function loadAuthSession(): Promise<AuthSessionRecord | null> {
  // Чтение тоже через очередь: иначе можно прочитать состояние в середине
  // чужой записи (sessionStorage уже очищен, IDB ещё нет).
  return withSessionLock(readSession)
}
