import { getDB, type LocalPhoto, type SyncOp } from '@/lib/db'

/**
 * Тонкая обёртка над загрузкой фото в R2. На текущий момент presign-endpoint
 * не реализован — это единственная точка, куда позже добавится вызов
 * edge-функции и `fetch(PUT)` к presigned URL. Сейчас функция бросает ошибку,
 * чтобы sync-движок корректно увеличивал backoff и не помечал операцию как
 * успешную.
 *
 * Идемпотентность: photo.id уже UUID, ключ в R2 детерминирован — повторный
 * вызов с тем же фото даёт тот же r2Key.
 */
export async function uploadPhoto(photo: LocalPhoto): Promise<{ r2Key: string }> {
  const r2Key = `photos/${photo.id}.jpg`
  // TODO: presign endpoint → fetch(PUT, presignedUrl, photo.blob)
  throw new Error('presign endpoint not configured')
  // eslint-disable-next-line no-unreachable
  return { r2Key }
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

export async function markPhotoSynced(photoId: string, r2Key: string): Promise<void> {
  const db = await getDB()
  const photo = await db.get('photos', photoId)
  if (!photo) return
  photo.syncStatus = 'synced'
  photo.r2Key = r2Key
  await db.put('photos', photo)
}
