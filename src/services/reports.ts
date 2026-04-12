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
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  authorName: string | null
  createdAt: string
  syncStatus: SyncStatus
  remoteOnly: boolean
}

interface RemoteReportRow {
  id: string
  project_id: string
  work_type_id: string
  performer_id: string
  plan_id: string | null
  description: string | null
  taken_at: string | null
  author_id: string
  created_at: string
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
    planId: r.planId,
    description: r.description,
    takenAt: r.takenAt,
    authorId: r.authorId,
    authorName: null,
    createdAt: r.createdAt,
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
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    authorName,
    createdAt: row.created_at,
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
    planId: s.planId,
    description: s.description,
    takenAt: s.takenAt,
    authorId: s.authorId,
    authorName: s.authorName,
    createdAt: s.createdAt,
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
  await Promise.all(
    unique.map(async (id) => {
      try {
        const { data } = await supabase.rpc('get_author_name', { p_author_id: id })
        result.set(id, (data as string | null) ?? null)
      } catch {
        result.set(id, null)
      }
    }),
  )
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
export async function loadMergedReports(): Promise<ReportCard[]> {
  const local = await listLocalReports()
  const localCards = local.map(fromLocal)
  const localIds = new Set(localCards.map((r) => r.id))

  const online = typeof navigator === 'undefined' ? true : navigator.onLine

  if (online) {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('id,project_id,work_type_id,performer_id,plan_id,description,taken_at,author_id,created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      const rows = (data as RemoteReportRow[] | null) ?? []

      // Разрешаем имена авторов одним проходом (паралельные RPC-вызовы).
      const authorNames = await resolveAuthorNames(rows.map((r) => r.author_id))
      const remoteCards = rows
        .filter((row) => !localIds.has(row.id))
        .map((row) => fromRemote(row, authorNames.get(row.author_id) ?? null))

      // Пишем минимальный snapshot для офлайна. Фото/mark тут не тянем —
      // их закэширует details-страница при открытии.
      await Promise.all(
        rows.map((row) =>
          cacheRemoteSnapshot({
            id: row.id,
            projectId: row.project_id,
            workTypeId: row.work_type_id,
            performerId: row.performer_id,
            planId: row.plan_id,
            description: row.description,
            takenAt: row.taken_at,
            authorId: row.author_id,
            authorName: authorNames.get(row.author_id) ?? null,
            createdAt: row.created_at,
            cachedAt: Date.now(),
            photos: [],
            mark: null,
          }),
        ),
      )

      return [...localCards, ...remoteCards].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )
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
  return [...localCards, ...cachedCards].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  )
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
      `id,project_id,work_type_id,performer_id,plan_id,description,taken_at,author_id,created_at,
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
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    authorName,
    createdAt: row.created_at,
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

export interface ReportUpdateInput {
  workTypeId: string
  performerId: string
  description: string | null
  takenAt: string | null
}

export async function updateRemoteReport(id: string, input: ReportUpdateInput): Promise<void> {
  const { error } = await supabase
    .from('reports')
    .update({
      work_type_id: input.workTypeId,
      performer_id: input.performerId,
      description: input.description,
      taken_at: input.takenAt,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
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
    ['reports', 'photos', 'plan_marks', 'sync_queue', 'remote_reports_cache'],
    'readwrite',
  )
  try { await tx.objectStore('reports').delete(id) } catch { /* может не быть */ }
  try { await tx.objectStore('remote_reports_cache').delete(id) } catch { /* может не быть */ }
  try { await tx.objectStore('plan_marks').delete(id) } catch { /* может не быть */ }

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

  await tx.done
}
