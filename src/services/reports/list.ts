import { supabase } from '@/lib/supabase'
import { listLocalReports } from '@/services/localReports'
import { getDB } from '@/lib/db'
import { cacheRemoteSnapshot } from './cache'
import { fromLocal, fromRemote, fromSnapshot } from './mappers'
import {
  FETCH_TIMEOUT_MS,
  PAGE_SIZE,
  type MergedReportsResult,
  type RemoteReportRow,
} from './types'

/**
 * Батчем разрешает ФИО авторов через SECURITY DEFINER RPC `get_author_name`.
 * Функция видит только тех авторов, чьи отчёты пользователь имеет право читать;
 * остальные возвращают null, что корректно: имя просто не отобразится.
 * Кэширует результат в памяти на время вызова — отчёты одного автора встречаются
 * пачками.
 */
async function resolveAuthorNames(ids: Iterable<string>): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set([...ids]))
  const result = new Map<string, string | null>()
  // Инициализируем null для всех, чтобы отсутствующие ФИО не ломали UI
  for (const id of unique) result.set(id, null)

  try {
    // Батчевый RPC вместо N отдельных вызовов
    const { data } = await supabase.rpc('get_author_names', { p_author_ids: unique })
    if (data) {
      for (const row of data as Array<{ author_id: string; full_name: string }>) {
        result.set(row.author_id, row.full_name)
      }
    }
  } catch {
    // Fallback: если batch RPC не доступен (ещё не развёрнут), пробуем по одному
    await Promise.all(
      unique.map(async (id) => {
        try {
          const { data } = await supabase.rpc('get_author_name', { p_author_id: id })
          result.set(id, (data as string | null) ?? null)
        } catch {
          // оставляем null
        }
      }),
    )
  }
  return result
}

/**
 * Объединяет локальные и серверные отчёты по id. Локальная запись приоритетнее
 * (у неё актуальный syncStatus, включая pending). При офлайне сервер заменяется
 * кэшем из `remote_reports_cache`, чтобы история всё равно открывалась.
 */
export async function loadMergedReports(cursor?: string): Promise<MergedReportsResult> {
  const local = await listLocalReports()
  const localCards = local.map(fromLocal)
  const localIds = new Set(localCards.map((r) => r.id))

  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  if (online) {
    try {
      const fetchRemote = async () => {
        let query = supabase
          .from('reports')
          .select('id,project_id,work_type_id,performer_id,work_assignment_id,plan_id,description,taken_at,author_id,created_at,updated_at')
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE)
        if (cursor) {
          query = query.lt('created_at', cursor)
        }
        const { data, error } = await query
        if (error) throw error
        return (data as RemoteReportRow[] | null) ?? []
      }
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Remote fetch timeout')), FETCH_TIMEOUT_MS),
      )
      const rows = await Promise.race([fetchRemote(), timeout])

      const authorNames = await resolveAuthorNames(rows.map((r) => r.author_id))
      const remoteCards = rows
        .filter((row) => !localIds.has(row.id))
        .map((row) => fromRemote(row, authorNames.get(row.author_id) ?? null))

      // Кэшируем для офлайна
      await Promise.all(
        rows.map((row) =>
          cacheRemoteSnapshot({
            id: row.id,
            projectId: row.project_id,
            workTypeId: row.work_type_id,
            performerId: row.performer_id,
            workAssignmentId: row.work_assignment_id ?? null,
            planId: row.plan_id,
            description: row.description,
            takenAt: row.taken_at,
            authorId: row.author_id,
            authorName: authorNames.get(row.author_id) ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at ?? null,
            cachedAt: Date.now(),
            photos: [],
            mark: null,
          }),
        ),
      )

      const hasMore = rows.length === PAGE_SIZE
      const nextCursor = rows.length > 0 ? rows[rows.length - 1].created_at : null

      // На первой странице включаем локальные; на последующих — только remote
      const cards = cursor
        ? remoteCards
        : [...localCards, ...remoteCards].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

      return { cards, hasMore, nextCursor }
    } catch {
      // Падение сетевого запроса — пользуемся кэшем как офлайн.
    }
  }

  // Офлайн или сеть упала: читаем снимки из кэша.
  const db = await getDB()
  const cached = await db.getAll('remote_reports_cache')
  const cachedCards = cached
    .filter((s) => !localIds.has(s.id))
    .map(fromSnapshot)
  const cards = [...localCards, ...cachedCards].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  )
  return { cards, hasMore: false, nextCursor: null }
}
