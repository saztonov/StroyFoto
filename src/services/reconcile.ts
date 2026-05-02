/**
 * Лёгкий pull-reconcile: подтягивает свежие серверные данные после
 * reconnect/visibility/push, обновляет remote_reports_cache и справочники.
 *
 * НЕ скачивает PDF/фото массово (это делает fullSync). Цель — быстро
 * привести IDB-кэш в соответствие с сервером, чтобы списки и карточки
 * отчётов показывали актуальные данные.
 */

import { apiFetch } from '@/lib/apiClient'
import { getDB, type RemoteReportSnapshot } from '@/lib/db'
import { loadProjectsForUser, loadWorkTypes, loadPerformers, loadWorkAssignments } from '@/services/catalogs'
import { emitReportsChanged, emitCatalogsChanged } from '@/services/invalidation'

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
  const resp = await apiFetch<{ items: RemoteReportRow[] }>(
    '/api/reports?limit=500',
  )
  const data = resp.items
  if (!data || data.length === 0) {
    // Всё равно прогоняем zombie-cleanup: возможно, на сервере действительно ничего нет.
  }

  const db = await getDB()
  const serverIds = new Set<string>()

  // Batch resolve author names через /api/author-names
  const authorIds = [...new Set(data.map((r) => r.author_id))]
  const authorNames = new Map<string, string | null>()
  if (authorIds.length > 0) {
    try {
      const namesResp = await apiFetch<{
        names: Array<{ author_id: string; full_name: string | null }>
      }>('/api/author-names', { method: 'POST', body: { ids: authorIds } })
      for (const row of namesResp.names) {
        authorNames.set(row.author_id, row.full_name)
      }
    } catch {
      // fallback: оставим null
    }
  }

  // Шаг 1: одной readonly-транзакцией собираем существующие photos/mark
  // из кэша. ВАЖНО: раньше эти данные читались внутри writable-транзакции
  // через отдельные `db.get(...)` вызовы — каждый создавал НОВУЮ
  // транзакцию, и control возвращался в event loop. По спецификации IDB
  // это закрывало исходную writable-tx, и следующий `tx.store.put()` падал
  // с InvalidStateError ("The transaction has finished").
  // Решение: читать всё одним проходом ДО открытия writable-tx.
  const existingByReportId = new Map<
    string,
    { photos: RemoteReportSnapshot['photos']; mark: RemoteReportSnapshot['mark'] }
  >()
  const readTx = db.transaction('remote_reports_cache', 'readonly')
  for (const row of data) {
    const existing = await readTx.store.get(row.id)
    existingByReportId.set(row.id, {
      photos: existing?.photos ?? [],
      mark: existing?.mark ?? null,
    })
  }
  await readTx.done

  // Шаг 2: writable-транзакция, внутри которой только синхронные
  // подготовки и tx.store.put — никаких внешних await'ов.
  const tx = db.transaction('remote_reports_cache', 'readwrite')
  const writes: Array<Promise<unknown>> = []
  for (const row of data) {
    serverIds.add(row.id)
    const cached = existingByReportId.get(row.id)
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
      photos: cached?.photos ?? [],
      mark: cached?.mark ?? null,
    }
    writes.push(tx.store.put(snap))
  }
  await Promise.all(writes)
  await tx.done

  // Удаляем zombie-кэш: записи, которых нет на сервере (удалены/доступ отозван)
  const allCached = await db.getAllKeys('remote_reports_cache')
  const localReportIds = new Set(await db.getAllKeys('reports'))
  const zombieTx = db.transaction('remote_reports_cache', 'readwrite')
  const zombieWrites: Array<Promise<unknown>> = []
  for (const cachedId of allCached) {
    if (serverIds.has(cachedId) || localReportIds.has(cachedId)) continue
    zombieWrites.push(zombieTx.store.delete(cachedId))
  }
  await Promise.all(zombieWrites)
  await zombieTx.done
}
