import { apiFetch } from '@/lib/apiClient'
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

interface AuthorNameRow {
  author_id: string
  full_name: string | null
}

/**
 * Резолвит ФИО авторов через GET /api/author-names. Backend фильтрует доступ
 * (как старый SECURITY DEFINER `get_author_names`): возвращает имя только
 * если автор связан с проектом, в котором состоит текущий пользователь,
 * либо если запрашивающий — admin.
 */
async function resolveAuthorNames(
  ids: Iterable<string>,
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set([...ids]))
  const result = new Map<string, string | null>()
  for (const id of unique) result.set(id, null)
  if (unique.length === 0) return result
  try {
    // Большие списки идут через POST, чтобы не упереться в URL-лимит.
    const data =
      unique.length > 80
        ? await apiFetch<{ names: AuthorNameRow[] }>('/api/author-names', {
            method: 'POST',
            body: { ids: unique },
          })
        : await apiFetch<{ names: AuthorNameRow[] }>(
            `/api/author-names?ids=${encodeURIComponent(unique.join(','))}`,
          )
    for (const row of data.names) {
      result.set(row.author_id, row.full_name)
    }
  } catch {
    // Молчаливый fallback: имена не отобразятся, но список не сломается.
  }
  return result
}

interface ListResponse {
  items: RemoteReportRow[]
  nextCursor: string | null
}

export async function loadMergedReports(
  cursor?: string,
): Promise<MergedReportsResult> {
  const local = await listLocalReports()
  const localCards = local.map(fromLocal)
  const localIds = new Set(localCards.map((r) => r.id))

  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  if (online) {
    try {
      const fetchRemote = async (): Promise<ListResponse> => {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        if (cursor) params.set('cursor', cursor)
        return await apiFetch<ListResponse>(
          `/api/reports?${params.toString()}`,
        )
      }
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Remote fetch timeout')), FETCH_TIMEOUT_MS),
      )
      const response = await Promise.race([fetchRemote(), timeout])
      const rows = response.items

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

      const hasMore = response.nextCursor !== null
      const nextCursor = response.nextCursor

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
