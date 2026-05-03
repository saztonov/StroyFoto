/**
 * Откат пакета офлайн-правок при OCC-конфликте или permanent ошибке.
 *
 * Когда пользователь сохраняет изменения отчёта офлайн, в очередь
 * попадают связанные операции с одним batchId: report_update + photo_delete +
 * mark_update. Если PATCH /api/reports/:id вернул 409 CONFLICT —
 * сервер уже опередил, и применять оставшийся пакет к устаревшей версии
 * нельзя (например, нельзя удалять фото из ушедшей вперёд серверной версии).
 * Поэтому ВСЁ, что было сделано в одном save, удаляется атомарно.
 */

import { getDB } from '@/lib/db'

export interface DiscardBatchResult {
  removedQueueOps: number
  removedMutations: number
  removedPhotoDeletes: number
  removedMarkUpdates: number
}

export async function discardOfflineBatch(
  batchId: string,
): Promise<DiscardBatchResult> {
  const db = await getDB()
  const tx = db.transaction(
    ['sync_queue', 'report_mutations', 'photo_deletes', 'mark_updates'],
    'readwrite',
  )
  const result: DiscardBatchResult = {
    removedQueueOps: 0,
    removedMutations: 0,
    removedPhotoDeletes: 0,
    removedMarkUpdates: 0,
  }

  // 1. report_mutations с batchId — собираем их id и удаляем.
  const mutations = await tx.objectStore('report_mutations').getAll()
  const mutationIdsToRemove = new Set<number>()
  for (const m of mutations) {
    if (m.batchId === batchId && m.id != null) {
      mutationIdsToRemove.add(m.id)
      await tx.objectStore('report_mutations').delete(m.id)
      result.removedMutations++
    }
  }

  // 2. photo_deletes с batchId.
  const photoDeletes = await tx.objectStore('photo_deletes').getAll()
  const photoIdsToRemove = new Set<string>()
  for (const pd of photoDeletes) {
    if (pd.batchId === batchId) {
      photoIdsToRemove.add(pd.id)
      await tx.objectStore('photo_deletes').delete(pd.id)
      result.removedPhotoDeletes++
    }
  }

  // 3. mark_updates с batchId.
  const markUpdates = await tx.objectStore('mark_updates').getAll()
  const reportIdsToRemove = new Set<string>()
  for (const mu of markUpdates) {
    if (mu.batchId === batchId) {
      reportIdsToRemove.add(mu.reportId)
      await tx.objectStore('mark_updates').delete(mu.reportId)
      result.removedMarkUpdates++
    }
  }

  // 4. sync_queue: удаляем все ops, ссылающиеся на удалённые сущности.
  const queue = await tx.objectStore('sync_queue').getAll()
  for (const op of queue) {
    if (op.id == null) continue
    let drop = false
    if (op.kind === 'report_update' || op.kind === 'report_delete') {
      const mutId = Number(op.entityId)
      if (mutationIdsToRemove.has(mutId)) drop = true
    } else if (op.kind === 'photo_delete') {
      if (photoIdsToRemove.has(op.entityId)) drop = true
    } else if (op.kind === 'mark_update') {
      if (reportIdsToRemove.has(op.entityId)) drop = true
    }
    if (drop) {
      await tx.objectStore('sync_queue').delete(op.id)
      result.removedQueueOps++
    }
  }

  await tx.done
  return result
}
