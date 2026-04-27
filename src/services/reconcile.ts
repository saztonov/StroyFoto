/**
 * Лёгкий pull-reconcile: подтягивает свежие серверные данные после
 * reconnect/visibility/push, обновляет remote_reports_cache и справочники.
 *
 * НЕ скачивает PDF/фото массово (это делает fullSync). Цель — быстро
 * привести IDB-кэш в соответствие с сервером, чтобы списки и карточки
 * отчётов показывали актуальные данные.
 */

import { supabase } from '@/lib/supabase'
import { getDB, type RemoteReportSnapshot } from '@/lib/db'
import { loadProjectsForUser, loadWorkTypes, loadPerformers, loadWorkAssignments } from '@/services/catalogs'
import { emitReportsChanged, emitCatalogsChanged } from '@/services/invalidation'

let reconciling = false

/**
 * Запускает лёгкий reconcile. Идемпотентен — параллельные вызовы
 * объединяются (второй ждёт завершения первого и пропускается).
 */
export async function reconcile(): Promise<void> {
  if (reconciling) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  reconciling = true

  try {
    // 1. Подтянуть свежие отчёты с сервера
    await reconcileReports()

    // 2. Обновить справочники
    await Promise.all([
      loadProjectsForUser().catch(() => undefined),
      loadWorkTypes().catch(() => undefined),
      loadPerformers().catch(() => undefined),
      loadWorkAssignments().catch(() => undefined),
    ])

    emitCatalogsChanged()
    emitReportsChanged()
  } catch (e) {
    console.warn('[reconcile] failed:', e)
  } finally {
    reconciling = false
  }
}

/**
 * Подтягивает свежие отчёты с сервера, обновляет remote_reports_cache,
 * удаляет zombie-кэш (отчёты, пропавшие из серверного ответа).
 */
async function reconcileReports(): Promise<void> {
  const { data, error } = await supabase
    .from('reports')
    .select('id,project_id,work_type_id,performer_id,work_assignment_id,plan_id,description,taken_at,author_id,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  if (!data) return

  const db = await getDB()
  const serverIds = new Set<string>()

  // Batch resolve author names через новый RPC
  const authorIds = [...new Set(data.map((r) => r.author_id))]
  const authorNames = new Map<string, string | null>()
  try {
    const { data: names } = await supabase.rpc('get_author_names', { p_author_ids: authorIds })
    if (names) {
      for (const row of names as Array<{ author_id: string; full_name: string }>) {
        authorNames.set(row.author_id, row.full_name)
      }
    }
  } catch {
    // fallback: оставим null
  }

  // Обновляем remote_reports_cache
  const tx = db.transaction('remote_reports_cache', 'readwrite')
  for (const row of data) {
    serverIds.add(row.id)
    const snap: RemoteReportSnapshot = {
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
      // Сохраняем существующие фото/метки из кэша если есть
      photos: (await getExistingPhotos(db, row.id)),
      mark: (await getExistingMark(db, row.id)),
    }
    await tx.store.put(snap)
  }
  await tx.done

  // Удаляем zombie-кэш: записи, которых нет на сервере (удалены/доступ отозван)
  const allCached = await db.getAllKeys('remote_reports_cache')
  const localReportIds = new Set((await db.getAllKeys('reports')))
  const zombieTx = db.transaction('remote_reports_cache', 'readwrite')
  for (const cachedId of allCached) {
    // Не удаляем если это локальный draft или если есть на сервере
    if (serverIds.has(cachedId) || localReportIds.has(cachedId)) continue
    await zombieTx.store.delete(cachedId)
  }
  await zombieTx.done
}

/** Достаёт сохранённые фото-метаданные из существующего кэша (не blob'ы). */
async function getExistingPhotos(
  db: Awaited<ReturnType<typeof getDB>>,
  reportId: string,
): Promise<RemoteReportSnapshot['photos']> {
  try {
    const existing = await db.get('remote_reports_cache', reportId)
    return existing?.photos ?? []
  } catch {
    return []
  }
}

/** Достаёт сохранённую метку плана из существующего кэша. */
async function getExistingMark(
  db: Awaited<ReturnType<typeof getDB>>,
  reportId: string,
): Promise<RemoteReportSnapshot['mark']> {
  try {
    const existing = await db.get('remote_reports_cache', reportId)
    return existing?.mark ?? null
  } catch {
    return null
  }
}
