import { supabase } from '@/lib/supabase'
import { getDB } from '@/lib/db'
import { ConflictError, type ReportUpdateInput } from './types'

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
