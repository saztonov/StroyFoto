import { apiFetch } from '@/lib/apiClient'
import { getDB, type LocalPhoto } from '@/lib/db'
import {
  PresignExpiredError,
  photoKey,
  photoThumbKey,
  putToPresigned,
  requestPresigned,
} from '@/services/objectStorage'

export interface UploadPhotoResult {
  objectKey: string
  thumbObjectKey: string
}

function isPresignExpired(e: unknown): boolean {
  if (e instanceof PresignExpiredError) return true
  // Cloud.ru возвращает 403 на просроченный SignatureV4 URL — этот случай
  // тоже лечим перевыпуском подписи.
  if (e instanceof Error && /S3 PUT 403/.test(e.message)) return true
  return false
}

async function uploadOnePhotoBlob(
  reportId: string,
  key: string,
  kind: 'photo' | 'photo_thumb',
  blob: Blob,
): Promise<void> {
  const presigned = await requestPresigned({
    op: 'put',
    kind,
    key,
    reportId,
    contentType: 'image/jpeg',
  })
  try {
    await putToPresigned(presigned, blob)
  } catch (e) {
    if (!isPresignExpired(e)) throw e
    // Один in-place retry: запрашиваем свежий presign и пробуем снова.
    // Если и второй раз падает — пускаем в общий backoff sync-loop'a.
    const fresh = await requestPresigned({
      op: 'put',
      kind,
      key,
      reportId,
      contentType: 'image/jpeg',
    })
    await putToPresigned(fresh, blob)
  }
}

/**
 * Загружает фото и его thumbnail в приватный бакет Cloud.ru S3 через
 * короткоживущие presigned URL, затем вставляет строку в `report_photos`
 * (авторизация на стороне backend). Все три шага идемпотентны:
 *   - object keys детерминированы от photo.id и report.id (UUID, client-gen),
 *     поэтому повторная загрузка перезапишет ровно те же объекты;
 *   - INSERT в report_photos идёт через upsert по PK, чтобы повторный sync
 *     после частичной ошибки не падал;
 *   - на просроченный presigned URL (PRESIGN_EXPIRED_BEFORE_USE или 403)
 *     делаем один in-place retry со свежим URL — иначе на медленном канале
 *     каждый retry попадал бы на тот же expired URL.
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

  // Заливаем последовательно (а не Promise.all): на медленных мобильных сетях
  // параллельные PUT пилят пропускную способность пополам и оба попадают
  // в timeout. Last-mile — узкое место, не сервер.
  await uploadOnePhotoBlob(photo.reportId, objectKey, 'photo', photo.blob)
  await uploadOnePhotoBlob(photo.reportId, thumbObjectKey, 'photo_thumb', thumbBlob)

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
