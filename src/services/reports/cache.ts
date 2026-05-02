import { getDB, type LocalPhoto, type RemoteReportSnapshot } from '@/lib/db'
import { fromSnapshot } from './mappers'
import type { RemoteReportFull } from './types'

/**
 * Пишет remote snapshot в `remote_reports_cache`. Retention сама отвечает
 * за очистку согласно device-setting. Фото-blob'ы сюда не кладутся — они
 * подтягиваются лениво при открытии details и кэшируются в store `photos`
 * с origin='remote'.
 */
export async function cacheRemoteSnapshot(snap: RemoteReportSnapshot): Promise<void> {
  const db = await getDB()
  try {
    await db.put('remote_reports_cache', snap)
  } catch (e) {
    console.error('cacheRemoteSnapshot put failed, snap.id=', snap.id, 'keys:', Object.keys(snap), e)
    throw e
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
      object_key: p.objectKey,
      thumb_object_key: p.thumbObjectKey ?? '',
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
