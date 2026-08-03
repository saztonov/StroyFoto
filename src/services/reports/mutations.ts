import { apiFetch, ApiError } from '@/lib/apiClient'
import { getDB } from '@/lib/db'
import { ConflictError, type ReportUpdateInput } from './types'

export async function updateRemoteReport(
  id: string,
  input: ReportUpdateInput,
): Promise<void> {
  const body: Record<string, unknown> = {
    work_type_id: input.workTypeId,
    performer_id: input.performerId,
    // Наличие performer_ids — сигнал серверу «клиент умеет множественность»,
    // и только тогда набор заменяется целиком. Без этого поля сервер лишь
    // дополняет набор, чтобы старый клиент не терял чужие связи.
    performer_ids: input.performerIds,
    work_assignment_id: input.workAssignmentId,
    description: input.description,
    taken_at: input.takenAt,
  }
  if (input.planId !== undefined) {
    body.plan_id = input.planId
  }
  if (input.expectedUpdatedAt) {
    body.expectedUpdatedAt = input.expectedUpdatedAt
  }
  try {
    await apiFetch(`/api/reports/${id}`, { method: 'PATCH', body })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'CONFLICT') {
      throw new ConflictError(
        'Отчёт был изменён другим пользователем. Обновите страницу и попробуйте снова.',
      )
    }
    throw e
  }
}

/**
 * Заменяет метку на плане для отчёта. PUT/DELETE на backend; backend сам
 * делает upsert по UNIQUE(report_id).
 */
export async function replaceRemotePlanMark(
  reportId: string,
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null,
): Promise<void> {
  if (mark) {
    await apiFetch(`/api/reports/${reportId}/plan-mark`, {
      method: 'PUT',
      body: {
        plan_id: mark.planId,
        page: mark.page,
        x_norm: mark.xNorm,
        y_norm: mark.yNorm,
      },
    })
  } else {
    await apiFetch(`/api/reports/${reportId}/plan-mark`, { method: 'DELETE' })
  }
}

export async function deleteRemoteReport(id: string): Promise<void> {
  await apiFetch(`/api/reports/${id}`, { method: 'DELETE' })
}

/**
 * Полная замена набора точек фотографий.
 *
 * Отдельный роут, а не расширение /plan-mark: старый сервер такого пути не
 * знает, а старый клиент продолжает управлять только легаси-меткой. Пустой
 * массив — законное «удалить все точки».
 *
 * `expectedMarksVersion` идёт по отдельной серверной версии, а не по
 * updated_at отчёта: иначе mark_update в офлайн-батче конфликтовал бы с
 * собственным же предшествующим report_update.
 */
export async function replaceRemotePhotoPlanMarks(
  reportId: string,
  marks: Array<{
    photoId: string
    planId: string
    page: number
    xNorm: number
    yNorm: number
  }>,
  expectedMarksVersion: string | null,
): Promise<string> {
  try {
    const resp = await apiFetch<{ photo_marks_version?: string }>(
      `/api/reports/${reportId}/photo-plan-marks`,
      {
        method: 'PUT',
        body: {
          marks: marks.map((m) => ({
            photo_id: m.photoId,
            plan_id: m.planId,
            page: m.page,
            x_norm: m.xNorm,
            y_norm: m.yNorm,
          })),
          expectedMarksVersion,
        },
      },
    )
    return resp?.photo_marks_version ?? '0'
  } catch (e) {
    if (e instanceof ApiError && e.code === 'CONFLICT') {
      throw new ConflictError(
        'Точки на плане были изменены другим пользователем. Обновите страницу и попробуйте снова.',
      )
    }
    throw e
  }
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
