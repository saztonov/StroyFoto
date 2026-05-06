import { apiFetch } from '@/lib/apiClient'
import { listLocalReports } from '@/services/localReports'
import { getDB } from '@/lib/db'
import { cacheRemoteSnapshot } from './cache'
import { fromLocal, fromRemote, fromSnapshot } from './mappers'
import {
  FETCH_TIMEOUT_MS,
  PAGE_SIZE,
  type MergedReportsResult,
  type ReportCard,
  type RemoteReportPhoto,
  type RemoteReportRow,
} from './types'

interface AuthorNameRow {
  author_id: string
  full_name: string | null
}

/**
 * Резолвит ФИО авторов через GET /api/author-names. Backend фильтрует доступ:
 * возвращает имя только если автор связан с проектом, в котором состоит
 * текущий пользователь, либо если запрашивающий — admin.
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

export interface LoadMergedReportsOpts {
  /** Cursor для пагинации (opaque base64-string от сервера). */
  cursor?: string
  /** Если задан — серверная фильтрация по project_id. */
  projectId?: string | null
  /** Список UUID типов работ для серверной фильтрации. */
  workTypeIds?: string[]
  /** Список месяцев `YYYY-MM` для серверной фильтрации (intersect c dateFrom/To). */
  months?: string[]
  /** ISO-строка нижней границы created_at. */
  dateFrom?: string | null
  /** ISO-строка верхней границы created_at. */
  dateTo?: string | null
  /**
   * Если true — сервер также возвращает report_photos[] для каждого отчёта,
   * результат содержит photosByReportId. Используется для режима «лента фото».
   */
  includePhotos?: boolean
}

/**
 * Локальный предикат, повторяющий серверные фильтры — чтобы offline-first
 * draft'ы и кэшированные snapshot'ы оставались видимыми в применимых
 * фильтрах. Сервер даёт правду для онлайн-страницы, клиент — для всего
 * остального (локальные drafts, оффлайн-кэш).
 */
function matchesFilters(
  card: ReportCard,
  opts: LoadMergedReportsOpts | undefined,
): boolean {
  if (!opts) return true
  if (opts.projectId && card.projectId !== opts.projectId) return false
  if (opts.workTypeIds && opts.workTypeIds.length > 0) {
    if (!opts.workTypeIds.includes(card.workTypeId)) return false
  }
  if (opts.months && opts.months.length > 0) {
    if (!opts.months.includes(card.createdAt.slice(0, 7))) return false
  }
  if (opts.dateFrom || opts.dateTo) {
    // Postgres ::text для timestamptz даёт формат "YYYY-MM-DD HH:MM:SS+ZZ",
    // а opts.* мы шлём как ISO 8601 — лексикографически они несравнимы.
    // Парсим оба и сравниваем по миллисекундам.
    const t = Date.parse(card.createdAt)
    if (Number.isFinite(t)) {
      if (opts.dateFrom) {
        const from = Date.parse(opts.dateFrom)
        if (Number.isFinite(from) && t < from) return false
      }
      if (opts.dateTo) {
        const to = Date.parse(opts.dateTo)
        if (Number.isFinite(to) && t > to) return false
      }
    }
  }
  return true
}

export async function loadMergedReports(
  opts?: LoadMergedReportsOpts,
): Promise<MergedReportsResult> {
  const cursor = opts?.cursor
  const local = await listLocalReports()
  const localCards = local
    .map(fromLocal)
    .filter((c) => matchesFilters(c, opts))
  const localIds = new Set(localCards.map((r) => r.id))

  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  if (online) {
    try {
      const fetchRemote = async (): Promise<ListResponse> => {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        if (cursor) params.set('cursor', cursor)
        if (opts?.projectId) params.set('project_id', opts.projectId)
        if (opts?.workTypeIds && opts.workTypeIds.length > 0) {
          params.set('work_type_ids', opts.workTypeIds.join(','))
        }
        if (opts?.months && opts.months.length > 0) {
          params.set('months', opts.months.join(','))
        }
        if (opts?.dateFrom) params.set('date_from', opts.dateFrom)
        if (opts?.dateTo) params.set('date_to', opts.dateTo)
        if (opts?.includePhotos) params.set('include_photos', 'true')
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

      // Кэшируем для офлайна. Photos сохраняем как metadata (без blob — blob
      // подгружается лениво при открытии details или фотоленты).
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

      let photosByReportId: Map<string, RemoteReportPhoto[]> | undefined
      if (opts?.includePhotos) {
        photosByReportId = new Map()
        for (const row of rows) {
          if (row.report_photos && row.report_photos.length > 0) {
            photosByReportId.set(row.id, row.report_photos)
          }
        }
      }

      return { cards, hasMore, nextCursor, photosByReportId }
    } catch {
      // Падение сетевого запроса — пользуемся кэшем как офлайн.
    }
  }

  // Офлайн или сеть упала: читаем снимки из кэша и применяем фильтры локально.
  const db = await getDB()
  const cached = await db.getAll('remote_reports_cache')
  const cachedCards = cached
    .filter((s) => !localIds.has(s.id))
    .map(fromSnapshot)
    .filter((c) => matchesFilters(c, opts))
  const cards = [...localCards, ...cachedCards].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  )
  return { cards, hasMore: false, nextCursor: null }
}
