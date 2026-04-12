import { supabase } from '@/lib/supabase'
import { getDB, type LocalPhoto } from '@/lib/db'
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
 * Никаких секретов R2 на клиенте: пресигнинг делает Supabase Edge Function
 * `sign`, см. supabase/functions/sign/.
 */
export async function uploadPhoto(photo: LocalPhoto): Promise<UploadPhotoResult> {
  if (!photo.thumbBlob) {
    throw new Error('uploadPhoto: remote-origin photo без thumbBlob нельзя загружать')
  }
  const thumbBlob = photo.thumbBlob
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
    putToPresigned(putThumb, thumbBlob),
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

/**
 * Удаляет фото с сервера: row из `report_photos` + объекты из R2 (best-effort).
 * R2-удаление через presigned DELETE; если R2 вернёт ошибку — не блокируем,
 * DB-строка является source of truth.
 */
export async function deleteRemotePhoto(
  photoId: string,
  reportId: string,
  r2Key: string,
  thumbR2Key: string,
): Promise<void> {
  // Best-effort R2 cleanup
  try {
    const [delOriginal, delThumb] = await Promise.all([
      requestPresigned({ op: 'delete', kind: 'photo', key: r2Key, reportId }),
      requestPresigned({ op: 'delete', kind: 'photo_thumb', key: thumbR2Key, reportId }),
    ])
    await Promise.allSettled([
      fetch(delOriginal.url, { method: 'DELETE', headers: delOriginal.headers }),
      fetch(delThumb.url, { method: 'DELETE', headers: delThumb.headers }),
    ])
  } catch {
    // R2 cleanup failed — продолжаем удаление row
  }

  const { error } = await supabase.from('report_photos').delete().eq('id', photoId)
  if (error) throw new Error(`report_photos delete: ${error.message}`)
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
  try {
    await db.put('photos', photo)
  } catch (e) {
    console.error('markPhotoSynced put failed, id=', photo.id, 'keys:', Object.keys(photo), e)
    throw e
  }
}
