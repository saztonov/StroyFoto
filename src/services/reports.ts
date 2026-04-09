import { supabase } from '@/lib/supabase'
import { listLocalReports } from '@/services/localReports'
import type { LocalReport, SyncStatus } from '@/lib/db'

/**
 * Унифицированная карточка отчёта для списка/детальной страницы.
 * `remoteOnly = true` означает, что отчёт ещё не сохранён в IndexedDB на этом
 * устройстве — фото и план придётся подгружать с сервера.
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
    createdAt: r.createdAt,
    syncStatus: r.syncStatus,
    remoteOnly: false,
  }
}

function fromRemote(row: RemoteReportRow): ReportCard {
  return {
    id: row.id,
    projectId: row.project_id,
    workTypeId: row.work_type_id,
    performerId: row.performer_id,
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    createdAt: row.created_at,
    syncStatus: 'synced',
    remoteOnly: true,
  }
}

/**
 * Объединяет локальные и серверные отчёты по id. Локальная запись приоритетнее
 * (у неё актуальный syncStatus, включая pending). Если устройство офлайн или
 * запрос к Supabase упал — возвращаем только локальные.
 */
export async function loadMergedReports(): Promise<ReportCard[]> {
  const local = await listLocalReports()
  const localCards = local.map(fromLocal)

  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  if (!online) return localCards

  try {
    const { data, error } = await supabase
      .from('reports')
      .select('id,project_id,work_type_id,performer_id,plan_id,description,taken_at,author_id,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const localIds = new Set(localCards.map((r) => r.id))
    const remoteCards = (data as RemoteReportRow[] | null ?? [])
      .filter((row) => !localIds.has(row.id))
      .map(fromRemote)
    return [...localCards, ...remoteCards].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    )
  } catch {
    return localCards
  }
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
 * Загружает один отчёт с сервера со всеми вложенными фото и меткой плана.
 * Используется детальной страницей, когда отчёт отсутствует локально.
 * В IndexedDB ничего не пишет — retention управляется только пользователем.
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

  const row = data as unknown as RemoteReportRow & {
    report_photos: RemoteReportPhoto[] | null
    report_plan_marks: RemoteReportMark[] | null
  }

  let authorName: string | null = null
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', row.author_id)
      .maybeSingle()
    authorName = (prof as { full_name: string | null } | null)?.full_name ?? null
  } catch {
    authorName = null
  }

  return {
    card: fromRemote(row),
    photos: row.report_photos ?? [],
    mark: row.report_plan_marks?.[0] ?? null,
    authorName,
  }
}
