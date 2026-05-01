import { supabase } from '@/lib/supabase'
import { cacheRemoteSnapshot } from './cache'
import { fromRemote } from './mappers'
import type { RemoteReportFull, RemoteReportRowWithNested } from './types'

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
       report_photos(id,r2_key,thumb_r2_key,width,height,taken_at,storage),
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
      storage: p.storage ?? 'cloudru',
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
