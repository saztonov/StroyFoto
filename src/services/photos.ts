import { supabase } from '@/lib/supabase'
import { getDB, type LocalPhoto, type SyncOp } from '@/lib/db'
import {
  photoKey,
  photoThumbKey,
  putToPresigned,
  requestPresigned,
} from '@/services/r2'

export interface UploadPhotoResult {
  r2Key: string
  thumbR2Key: string
}

/**
 * Загружает фото и его thumbnail в приватный R2 через короткоживущие presigned
 * URL, затем вставляет строку в `report_photos` (RLS проверит автора). Все три
 * шага идемпотентны:
 *   - object keys детерминированы от photo.id и report.id (UUID, client-gen),
 *     поэтому повторная загрузка перезапишет ровно те же объекты;
 *   - INSERT в report_photos идёт через upsert по PK, чтобы повторный sync
 *     после частичной ошибки не падал.
 *
 * Никаких секретов R2 на клиенте: пресигнинг делает доверенный Worker,
 * см. worker/.
 */
export async function uploadPhoto(photo: LocalPhoto): Promise<UploadPhotoResult> {
  const r2Key = photoKey(photo.reportId, photo.id)
  const thumbR2Key = photoThumbKey(photo.reportId, photo.id)

  const [putOriginal, putThumb] = await Promise.all([
    requestPresigned({
      op: 'put',
      kind: 'photo',
      key: r2Key,
      reportId: photo.reportId,
      contentType: 'image/jpeg',
    }),
    requestPresigned({
      op: 'put',
      kind: 'photo_thumb',
      key: thumbR2Key,
      reportId: photo.reportId,
      contentType: 'image/jpeg',
    }),
  ])

  await Promise.all([
    putToPresigned(putOriginal, photo.blob),
    putToPresigned(putThumb, photo.thumbBlob),
  ])

  const { error } = await supabase.from('report_photos').upsert(
    {
      id: photo.id,
      report_id: photo.reportId,
      r2_key: r2Key,
      thumb_r2_key: thumbR2Key,
      width: photo.width,
      height: photo.height,
      taken_at: photo.takenAt,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`report_photos insert: ${error.message}`)

  return { r2Key, thumbR2Key }
}

export async function enqueuePhotoUpload(photoId: string): Promise<void> {
  const db = await getDB()
  const op: SyncOp = {
    kind: 'photo',
    entityId: photoId,
    attempts: 0,
    nextAttemptAt: Date.now() + 200,
    lastError: null,
  }
  await db.add('sync_queue', op)
}

export async function markPhotoSynced(
  photoId: string,
  r2Key: string,
  thumbR2Key: string,
): Promise<void> {
  const db = await getDB()
  const photo = await db.get('photos', photoId)
  if (!photo) return
  photo.syncStatus = 'synced'
  photo.r2Key = r2Key
  photo.thumbR2Key = thumbR2Key
  await db.put('photos', photo)
}
