import { supabase } from '@/lib/supabase'
import { listLocalReports } from '@/services/localReports'
import {
  getDB,
  type LocalPhoto,
  type LocalReport,
  type RemoteReportSnapshot,
  type SyncStatus,
} from '@/lib/db'

/**
 * Унифицированная карточка отчёта для списка/детальной страницы.
 * `remoteOnly = true` означает, что отчёт ещё не сохранён в IndexedDB на этом
 * устройстве как черновик — это либо свежая запись с сервера, либо кэш истории.
 */
export interface ReportCard {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  authorName: string | null
  createdAt: string
  updatedAt: string | null
  syncStatus: SyncStatus
  remoteOnly: boolean
}

interface RemoteReportRow {
  id: string
  project_id: string
  work_type_id: string
  performer_id: string
  work_assignment_id: string | null
  plan_id: string | null
  description: string | null
  taken_at: string | null
  author_id: string
  created_at: string
  updated_at: string | null
}

interface RemoteReportRowWithNested extends RemoteReportRow {
  report_photos: RemoteReportPhoto[] | null
  report_plan_marks: RemoteReportMark[] | null
}

function fromLocal(r: LocalReport): ReportCard {
  return {
    id: r.id,
    projectId: r.projectId,
    workTypeId: r.workTypeId,
    performerId: r.performerId,
    workAssignmentId: r.workAssignmentId ?? null,
    planId: r.planId,
    description: r.description,
    takenAt: r.takenAt,
    authorId: r.authorId,
    authorName: null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? null,
    syncStatus: r.syncStatus,
    remoteOnly: false,
  }
}

function fromRemote(row: RemoteReportRow, authorName: string | null = null): ReportCard {
  return {
    id: row.id,
    projectId: row.project_id,
    workTypeId: row.work_type_id,
    performerId: row.performer_id,
    workAssignmentId: row.work_assignment_id ?? null,
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    authorName,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    syncStatus: 'synced',
    remoteOnly: true,
  }
}

function fromSnapshot(s: RemoteReportSnapshot): ReportCard {
  return {
    id: s.id,
    projectId: s.projectId,
    workTypeId: s.workTypeId,
    performerId: s.performerId,
    workAssignmentId: s.workAssignmentId ?? null,
    planId: s.planId,
    description: s.description,
    takenAt: s.takenAt,
    authorId: s.authorId,
    authorName: s.authorName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? null,
    syncStatus: 'synced',
    remoteOnly: true,
  }
}

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
 * Пишет remote snapshot в `remote_reports_cache`. Retention сама отвечает
 * за очистку согласно device-setting. Фото-blob'ы сюда не кладутся — они
 * подтягиваются лениво при открытии details и кэшируются в store `photos`
 * с origin='remote'.
 */
async function cacheRemoteSnapshot(snap: RemoteReportSnapshot): Promise<void> {
  const db = await getDB()
  try {
    await db.put('remote_reports_cache', snap)
  } catch (e) {
    console.error('cacheRemoteSnapshot put failed, snap.id=', snap.id, 'keys:', Object.keys(snap), e)
    throw e
  }
}

/**
 * Объединяет локальные и серверные отчёты по id. Локальная запись приоритетнее
 * (у неё актуальный syncStatus, включая pending). При офлайне сервер заменяется
 * кэшем из `remote_reports_cache`, чтобы история всё равно открывалась.
 */
/** Таймаут для сетевых запросов при загрузке списка отчётов (мс). */
const FETCH_TIMEOUT_MS = 5_000
const PAGE_SIZE = 200

export interface MergedReportsResult {
  cards: ReportCard[]
  hasMore: boolean
  nextCursor: string | null
}

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

export interface RemoteReportPhoto {
  id: string
  r2_key: string
  thumb_r2_key: string
  width: number | null
  height: number | null
  taken_at: string | null
}

export interface RemoteReportMark {
  plan_id: string
  page: number
  x_norm: number
  y_norm: number
}

export interface RemoteReportFull {
  card: ReportCard
  photos: RemoteReportPhoto[]
  mark: RemoteReportMark | null
  authorName: string | null
}

/**
 * Загружает один отчёт с сервера со всеми вложенными фото и меткой плана
 * и записывает полный snapshot в `remote_reports_cache` для офлайна.
 * Имя автора вытаскивается через SECURITY DEFINER RPC get_author_name,
 * который минимально раскрывает доступ к profiles.
 */
export async function loadRemoteReportById(id: string): Promise<RemoteReportFull | null> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `id,project_id,work_type_id,performer_id,work_assignment_id,plan_id,description,taken_at,author_id,created_at,updated_at,
       report_photos(id,r2_key,thumb_r2_key,width,height,taken_at),
       report_plan_marks(plan_id,page,x_norm,y_norm)`,
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as RemoteReportRowWithNested

  let authorName: string | null = null
  try {
    const { data: nameData } = await supabase.rpc('get_author_name', { p_author_id: row.author_id })
    authorName = (nameData as string | null) ?? null
  } catch {
    authorName = null
  }

  const photos = row.report_photos ?? []
  const mark = row.report_plan_marks?.[0] ?? null

  await cacheRemoteSnapshot({
    id: row.id,
    projectId: row.project_id,
    workTypeId: row.work_type_id,
    performerId: row.performer_id,
    workAssignmentId: row.work_assignment_id ?? null,
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    authorName,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    cachedAt: Date.now(),
    photos: photos.map((p) => ({
      id: p.id,
      r2Key: p.r2_key,
      thumbR2Key: p.thumb_r2_key,
      width: p.width,
      height: p.height,
      takenAt: p.taken_at,
    })),
    mark: mark
      ? { planId: mark.plan_id, page: mark.page, xNorm: mark.x_norm, yNorm: mark.y_norm }
      : null,
  })

  return {
    card: fromRemote(row, authorName),
    photos,
    mark,
    authorName,
  }
}

/**
 * Офлайн-фоллбэк для страницы details: возвращает полностью закэшированный
 * snapshot (с фото/меткой) из IDB, если он был записан при предыдущем онлайн-просмотре.
 */
export async function loadCachedRemoteReport(id: string): Promise<RemoteReportFull | null> {
  const db = await getDB()
  const snap = await db.get('remote_reports_cache', id)
  if (!snap) return null
  return {
    card: fromSnapshot(snap),
    photos: snap.photos.map((p) => ({
      id: p.id,
      r2_key: p.r2Key,
      thumb_r2_key: p.thumbR2Key ?? '',
      width: p.width,
      height: p.height,
      taken_at: p.takenAt,
    })),
    mark: snap.mark
      ? {
          plan_id: snap.mark.planId,
          page: snap.mark.page,
          x_norm: snap.mark.xNorm,
          y_norm: snap.mark.yNorm,
        }
      : null,
    authorName: snap.authorName,
  }
}

/**
 * Помещает blob фото в store `photos` с origin='remote'. Используется
 * ленивым пре-кэшем details-страницы при онлайн-просмотре, чтобы второй
 * заход работал офлайн.
 */
export async function cacheRemotePhotoBlob(
  reportId: string,
  photoId: string,
  fullBlob: Blob,
  thumbBlob: Blob | null,
): Promise<void> {
  const db = await getDB()
  const existing = await db.get('photos', photoId)
  // Никогда не перезаписываем local draft — у него origin='local' и blob исходит от пользователя.
  if (existing && existing.origin === 'local') return
  const record: LocalPhoto = {
    id: photoId,
    reportId,
    blob: fullBlob,
    thumbBlob,
    width: existing?.width ?? 0,
    height: existing?.height ?? 0,
    takenAt: existing?.takenAt ?? null,
    order: existing?.order ?? 0,
    syncStatus: 'synced',
    origin: 'remote',
    cachedAt: Date.now(),
  }
  try {
    await db.put('photos', record)
  } catch (e) {
    console.error('cacheRemotePhotoBlob put failed, id=', photoId, 'keys:', Object.keys(record), e)
    throw e
  }
}

export async function getCachedRemotePhotoBlob(photoId: string): Promise<LocalPhoto | undefined> {
  const db = await getDB()
  const rec = await db.get('photos', photoId)
  return rec
}

// ---------- Edit / Delete ----------

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export interface ReportUpdateInput {
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  description: string | null
  takenAt: string | null
  planId?: string | null // undefined = не менять, null = убрать
  expectedUpdatedAt?: string | null
}

export async function updateRemoteReport(id: string, input: ReportUpdateInput): Promise<void> {
  const payload: Record<string, unknown> = {
    work_type_id: input.workTypeId,
    performer_id: input.performerId,
    work_assignment_id: input.workAssignmentId,
    description: input.description,
    taken_at: input.takenAt,
  }
  if (input.planId !== undefined) {
    payload.plan_id = input.planId
  }
  let query = supabase
    .from('reports')
    .update(payload)
    .eq('id', id)

  // Optimistic concurrency: если передан expectedUpdatedAt, проверяем что
  // отчёт не был изменён другим пользователем с момента загрузки.
  if (input.expectedUpdatedAt) {
    query = query.eq('updated_at', input.expectedUpdatedAt)
  }

  const { data, error } = await query.select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new ConflictError('Отчёт был изменён другим пользователем. Обновите страницу и попробуйте снова.')
  }
}

/**
 * Заменяет метку на плане для отчёта: удаляет старую + вставляет новую.
 * Если mark = null — только удаление (отвязка метки).
 */
export async function replaceRemotePlanMark(
  reportId: string,
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null,
): Promise<void> {
  // Удаляем существующую метку (idempotent — может не быть)
  const { error: delErr } = await supabase
    .from('report_plan_marks')
    .delete()
    .eq('report_id', reportId)
  if (delErr) throw new Error(`plan mark delete: ${delErr.message}`)

  if (mark) {
    const { error: insErr } = await supabase.from('report_plan_marks').insert({
      report_id: reportId,
      plan_id: mark.planId,
      page: mark.page,
      x_norm: mark.xNorm,
      y_norm: mark.yNorm,
    })
    if (insErr) throw new Error(`plan mark insert: ${insErr.message}`)
  }
}

export async function deleteRemoteReport(id: string): Promise<void> {
  const { error } = await supabase.from('reports').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Очищает локальные данные отчёта из IndexedDB после удаления на сервере.
 */
export async function purgeLocalReportData(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['reports', 'photos', 'plan_marks', 'sync_queue', 'remote_reports_cache', 'photo_deletes', 'mark_updates'],
    'readwrite',
  )
  try { await tx.objectStore('reports').delete(id) } catch { /* может не быть */ }
  try { await tx.objectStore('remote_reports_cache').delete(id) } catch { /* может не быть */ }
  try { await tx.objectStore('plan_marks').delete(id) } catch { /* может не быть */ }
  try { await tx.objectStore('mark_updates').delete(id) } catch { /* может не быть */ }

  const photosStore = tx.objectStore('photos')
  const photoKeys = await photosStore.index('by_report').getAllKeys(id)
  for (const key of photoKeys) {
    await photosStore.delete(key)
  }

  const queueStore = tx.objectStore('sync_queue')
  const queueKeys = await queueStore.index('by_report').getAllKeys(id)
  for (const key of queueKeys) {
    await queueStore.delete(key)
  }

  // photo_deletes keyed by photo id — iterate and filter by reportId
  const pdStore = tx.objectStore('photo_deletes')
  const allPd = await pdStore.getAll()
  for (const pd of allPd) {
    if (pd.reportId === id) await pdStore.delete(pd.id)
  }

  await tx.done
}
