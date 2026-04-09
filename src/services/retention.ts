import { getDB } from '@/lib/db'
import { getRetention } from '@/services/deviceSettings'

/**
 * Очищает локальную историю отчётов согласно настройке устройства.
 * ВАЖНО: удаляются ТОЛЬКО записи со статусом 'synced'. Любые
 * несинхронизированные данные (pending, failed, syncing, pending_upload)
 * остаются нетронутыми.
 */
export async function applyRetention(): Promise<{ removed: number }> {
  const setting = await getRetention()
  if (setting.mode === 'all') return { removed: 0 }

  const db = await getDB()
  const cutoffMs =
    setting.mode === 'from_date' && setting.fromDate
      ? new Date(setting.fromDate).getTime()
      : null

  const tx = db.transaction(['reports', 'photos', 'plan_marks'], 'readwrite')
  const reportsStore = tx.objectStore('reports')
  const photosStore = tx.objectStore('photos')
  const marksStore = tx.objectStore('plan_marks')
  const photoIndex = photosStore.index('by_report')

  let removed = 0
  for (const report of await reportsStore.getAll()) {
    if (report.syncStatus !== 'synced') continue

    if (setting.mode === 'from_date') {
      if (cutoffMs == null) continue
      const createdMs = new Date(report.createdAt).getTime()
      if (createdMs >= cutoffMs) continue
    }
    // mode === 'none' → удаляем все synced

    // Дополнительная защита: если у отчёта остались фото с pending_upload,
    // не трогаем — иначе потеряем оригиналы blob.
    const photos = await photoIndex.getAll(report.id)
    const hasUnsyncedPhoto = photos.some((p) => p.syncStatus !== 'synced')
    if (hasUnsyncedPhoto) continue

    for (const p of photos) await photosStore.delete(p.id)
    await marksStore.delete(report.id)
    await reportsStore.delete(report.id)
    removed += 1
  }

  await tx.done
  return { removed }
}
