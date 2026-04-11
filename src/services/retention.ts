import { getDB } from '@/lib/db'
import { getRetention } from '@/services/deviceSettings'

/**
 * Применяет device-level retention к локальному хранилищу.
 *
 * ГАРАНТИИ:
 *  - Никогда не удаляет local draft (origin='local'), если у него остались
 *    фото с неsynced статусом ИЛИ есть хоть одна задача в sync_queue.
 *  - Remote snapshots (`remote_reports_cache` + фото origin='remote') чистятся
 *    по тем же правилам device-setting, но независимо от local drafts —
 *    remote-кэш это производная от сервера, его безопасно выбросить.
 *  - mode='all'  → ничего не удаляет;
 *    mode='from_date' → удаляет всё с `createdAt < fromDate`;
 *    mode='none' → удаляет всю историю.
 */
export async function applyRetention(): Promise<{ removed: number; removedRemote: number }> {
  const setting = await getRetention()
  if (setting.mode === 'all') return { removed: 0, removedRemote: 0 }

  const db = await getDB()
  const cutoffMs =
    setting.mode === 'from_date' && setting.fromDate
      ? new Date(setting.fromDate).getTime()
      : null
  const shouldDrop = (createdAt: string): boolean => {
    if (setting.mode === 'none') return true
    if (cutoffMs == null) return false
    return new Date(createdAt).getTime() < cutoffMs
  }

  let removed = 0
  let removedRemote = 0

  // ---------- 1. Local drafts (store `reports`) ----------
  {
    const tx = db.transaction(['reports', 'photos', 'plan_marks', 'sync_queue'], 'readwrite')
    const reportsStore = tx.objectStore('reports')
    const photosStore = tx.objectStore('photos')
    const marksStore = tx.objectStore('plan_marks')
    const queueIndex = tx.objectStore('sync_queue').index('by_report')
    const photoIndex = photosStore.index('by_report')

    for (const report of await reportsStore.getAll()) {
      if (report.syncStatus !== 'synced') continue
      if (!shouldDrop(report.createdAt)) continue

      // Страховка №1: есть ли у отчёта открытые sync-задачи (фото/mark/work_type).
      const pendingOps = await queueIndex.count(IDBKeyRange.only(report.id))
      if (pendingOps > 0) continue

      // Страховка №2: все local-фото этого отчёта должны быть synced.
      const photos = await photoIndex.getAll(report.id)
      const localPhotos = photos.filter((p) => p.origin !== 'remote')
      if (localPhotos.some((p) => p.syncStatus !== 'synced')) continue

      for (const p of localPhotos) await photosStore.delete(p.id)
      await marksStore.delete(report.id)
      await reportsStore.delete(report.id)
      removed += 1
    }

    await tx.done
  }

  // ---------- 2. Remote cache (store `remote_reports_cache`) ----------
  {
    const tx = db.transaction(['remote_reports_cache', 'photos'], 'readwrite')
    const cacheStore = tx.objectStore('remote_reports_cache')
    const photosStore = tx.objectStore('photos')
    const photoIndex = photosStore.index('by_report')

    for (const snap of await cacheStore.getAll()) {
      if (!shouldDrop(snap.createdAt)) continue

      // remote-фото можно удалять безопасно: они восстанавливаются по presign.
      const photos = await photoIndex.getAll(snap.id)
      for (const p of photos) {
        if (p.origin === 'remote') await photosStore.delete(p.id)
      }
      await cacheStore.delete(snap.id)
      removedRemote += 1
    }

    await tx.done
  }

  return { removed, removedRemote }
}
