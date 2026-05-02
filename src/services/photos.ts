import { apiFetch } from '@/lib/apiClient'
import { getDB, type LocalPhoto } from '@/lib/db'
import {
  photoKey,
  photoThumbKey,
  putToPresigned,
  requestPresigned,
} from '@/services/objectStorage'

export interface UploadPhotoResult {
  objectKey: string
  thumbObjectKey: string
}

/**
 * Загружает фото и его thumbnail в приватный бакет Cloud.ru S3 через
 * короткоживущие presigned URL, затем вставляет строку в `report_photos`
 * (авторизация на стороне backend). Все три шага идемпотентны:
 *   - object keys детерминированы от photo.id и report.id (UUID, client-gen),
 *     поэтому повторная загрузка перезапишет ровно те же объекты;
 *   - INSERT в report_photos идёт через upsert по PK, чтобы повторный sync
 *     после частичной ошибки не падал.
 *
 * Никаких секретов хранилища на клиенте: presign делает backend
 * `POST /api/storage/presign` (см. server/src/routes/presign.ts).
 */
export async function uploadPhoto(photo: LocalPhoto): Promise<UploadPhotoResult> {
  if (!photo.thumbBlob) {
    throw new Error('uploadPhoto: remote-origin photo без thumbBlob нельзя загружать')
  }
  const thumbBlob = photo.thumbBlob
  const objectKey = photoKey(photo.reportId, photo.id)
  const thumbObjectKey = photoThumbKey(photo.reportId, photo.id)

  const [putOriginal, putThumb] = await Promise.all([
    requestPresigned({
      op: 'put',
      kind: 'photo',
      key: objectKey,
      reportId: photo.reportId,
      contentType: 'image/jpeg',
    }),
    requestPresigned({
      op: 'put',
      kind: 'photo_thumb',
      key: thumbObjectKey,
      reportId: photo.reportId,
      contentType: 'image/jpeg',
    }),
  ])

  await Promise.all([
    putToPresigned(putOriginal, photo.blob),
    putToPresigned(putThumb, thumbBlob),
  ])

  await apiFetch(`/api/report-photos/${photo.id}`, {
    method: 'PUT',
    body: {
      report_id: photo.reportId,
      object_key: objectKey,
      thumb_object_key: thumbObjectKey,
      width: photo.width,
      height: photo.height,
      taken_at: photo.takenAt,
    },
  })

  return { objectKey, thumbObjectKey }
}

/**
 * Удаляет фото с сервера: row из `report_photos` + объекты из Cloud.ru S3
 * (best-effort). DELETE через presigned URL; если хранилище вернёт ошибку —
 * не блокируем, DB-строка является source of truth.
 */
export async function deleteRemotePhoto(
  photoId: string,
  reportId: string,
  objectKey: string,
  thumbObjectKey: string,
): Promise<void> {
  // Best-effort cleanup в объектном хранилище.
  try {
    const [delOriginal, delThumb] = await Promise.all([
      requestPresigned({ op: 'delete', kind: 'photo', key: objectKey, reportId }),
      requestPresigned({ op: 'delete', kind: 'photo_thumb', key: thumbObjectKey, reportId }),
    ])
    await Promise.allSettled([
      fetch(delOriginal.url, { method: 'DELETE', headers: delOriginal.headers }),
      fetch(delThumb.url, { method: 'DELETE', headers: delThumb.headers }),
    ])
  } catch {
    // cleanup в S3 упал — продолжаем удаление row
  }

  await apiFetch(`/api/report-photos/${photoId}`, { method: 'DELETE' })
}

export async function markPhotoSynced(
  photoId: string,
  objectKey: string,
  thumbObjectKey: string,
): Promise<void> {
  const db = await getDB()
  const photo = await db.get('photos', photoId)
  if (!photo) return
  photo.syncStatus = 'synced'
  photo.objectKey = objectKey
  photo.thumbObjectKey = thumbObjectKey
  try {
    await db.put('photos', photo)
  } catch (e) {
    console.error('markPhotoSynced put failed, id=', photo.id, 'keys:', Object.keys(photo), e)
    throw e
  }
}
