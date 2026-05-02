import { apiFetch } from '@/lib/apiClient'
import { getDB, type LocalPhoto } from '@/lib/db'
import {
  photoKey,
  photoThumbKey,
  putToPresigned,
  requestPresigned,
  type StorageProvider,
} from '@/services/r2'

export interface UploadPhotoResult {
  r2Key: string
  thumbR2Key: string
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

  // storage='cloudru' — новый объект всегда уходит в Cloud.ru.
  await apiFetch(`/api/report-photos/${photo.id}`, {
    method: 'PUT',
    body: {
      report_id: photo.reportId,
      r2_key: r2Key,
      thumb_r2_key: thumbR2Key,
      width: photo.width,
      height: photo.height,
      taken_at: photo.takenAt,
      storage: 'cloudru',
    },
  })

  return { r2Key, thumbR2Key }
}

/**
 * Удаляет фото с сервера: row из `report_photos` + объекты из хранилища
 * (best-effort). DELETE через presigned URL; если хранилище вернёт ошибку —
 * не блокируем, DB-строка является source of truth.
 *
 * `storage` определяет, в каком бакете лежат объекты (cloudru/r2). Без
 * указания берётся 'cloudru'.
 */
export async function deleteRemotePhoto(
  photoId: string,
  reportId: string,
  r2Key: string,
  thumbR2Key: string,
  storage: StorageProvider = 'cloudru',
): Promise<void> {
  // Best-effort cleanup в объектном хранилище.
  try {
    const [delOriginal, delThumb] = await Promise.all([
      requestPresigned({ op: 'delete', kind: 'photo', key: r2Key, reportId, provider: storage }),
      requestPresigned({ op: 'delete', kind: 'photo_thumb', key: thumbR2Key, reportId, provider: storage }),
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
