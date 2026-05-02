import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'pending_upload'

export interface LocalReport {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  createdAt: string
  updatedAt: string | null
  syncStatus: SyncStatus
  lastError: string | null
}

export type PhotoOrigin = 'local' | 'remote'

export interface LocalPhoto {
  id: string
  reportId: string
  blob: Blob
  // thumbBlob отсутствует для remote-кэша до тех пор, пока не загружен превью.
  thumbBlob: Blob | null
  width: number
  height: number
  takenAt: string | null
  order: number
  syncStatus: SyncStatus
  objectKey?: string | null
  thumbObjectKey?: string | null
  // local — пользовательский черновик, remote — скачанный кэш истории.
  // Retention чистит их по разным правилам; local никогда не удаляется до синка.
  origin: PhotoOrigin
  cachedAt?: number
}

export interface LocalPlanMark {
  reportId: string
  planId: string
  page: number
  xNorm: number
  yNorm: number
  syncStatus: SyncStatus
}

export type SyncOpKind = 'report' | 'mark' | 'photo' | 'work_type' | 'work_assignment' | 'report_update' | 'report_delete' | 'photo_delete' | 'mark_update'

export interface SyncOp {
  id?: number
  kind: SyncOpKind
  entityId: string
  reportId?: string // кэш для быстрой проверки в retention/aggregation (photo/mark/work_type → reportId)
  attempts: number
  nextAttemptAt: number
  lastError: string | null
}

/**
 * Локальный черновик вида работ, добавленного пользователем офлайн.
 * До синка отчёт ссылается на client UUID; после успешной вставки
 * мы пишем серверный ряд с тем же UUID (RLS разрешает active insert),
 * и id сходится без перелинковки.
 */
export interface LocalWorkType {
  id: string
  name: string
  createdAt: string
  syncStatus: SyncStatus
}

/**
 * Локальный черновик назначения работ, добавленного пользователем офлайн.
 * Зеркало `LocalWorkType`: при синке — upsert в public.work_assignments
 * с тем же UUID, на который уже ссылается отчёт.
 */
export interface LocalWorkAssignment {
  id: string
  name: string
  createdAt: string
  syncStatus: SyncStatus
}

/**
 * Мутация существующего отчёта, поставленная в очередь офлайн.
 * Для update содержит payload с новыми значениями + baseUpdatedAt для OCC.
 * Для delete — payload null.
 */
export interface ReportMutation {
  id?: number // auto-increment
  kind: 'update' | 'delete'
  reportId: string
  baseUpdatedAt: string
  payload: {
    workTypeId: string
    performerId: string
    workAssignmentId: string | null
    description: string | null
    takenAt: string | null
    planId?: string | null // undefined = не менять, null = убрать
  } | null
  queuedAt: number
  lastError: string | null
  attempts: number
  nextAttemptAt: number
}

/**
 * Снимок отчёта, прочитанного с сервера. Используется только для
 * offline-просмотра истории; retention чистит эти записи по device
 * setting, но никогда не трогает локальные drafts в store `reports`.
 */
export interface RemoteReportSnapshot {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  authorName: string | null
  createdAt: string
  updatedAt: string | null
  cachedAt: number
  // фото-метаданные хранятся здесь, бинарные blobs — в store `photos` c origin='remote'
  photos: Array<{
    id: string
    objectKey: string
    thumbObjectKey: string | null
    width: number | null
    height: number | null
    takenAt: string | null
  }>
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null
}

export type RetentionMode = 'all' | 'from_date' | 'none'

export interface RetentionSetting {
  mode: RetentionMode
  fromDate?: string // ISO yyyy-mm-dd
}

export interface DeviceSettingRecord {
  key: string
  value: unknown
}

export type CatalogKey = 'projects' | 'work_types' | 'performers' | 'work_assignments' | 'plans'

export interface CatalogRecord {
  key: CatalogKey
  payload: unknown
  updatedAt: number
}

/**
 * Запись на удаление фото с сервера, поставленная в очередь офлайн.
 */
export interface PhotoDeleteRecord {
  id: string // photo UUID
  reportId: string
  objectKey: string
  thumbObjectKey: string
}

/**
 * Запись на обновление/удаление метки на плане, поставленная в очередь офлайн.
 * Если planId = null — метку нужно удалить.
 */
export interface MarkUpdateRecord {
  reportId: string
  planId: string | null
  page: number | null
  xNorm: number | null
  yNorm: number | null
}

/**
 * Сохранённая сессия после логина. Хранится только refresh-токен —
 * access-токен живёт в памяти (XSS-резистентность).
 */
export interface AuthSessionRecord {
  key: 'session'
  userId: string
  email: string
  refreshToken: string
  refreshExpiresAt: number // ms epoch
  savedAt: number
}

interface StroyFotoDB extends DBSchema {
  reports: {
    key: string
    value: LocalReport
    indexes: { by_status: SyncStatus; by_created: string }
  }
  photos: {
    key: string
    value: LocalPhoto
    indexes: { by_report: string; by_origin: PhotoOrigin }
  }
  plan_marks: {
    key: string
    value: LocalPlanMark
  }
  plans_cache: {
    key: string
    value: { id: string; blob: Blob; cachedAt: number }
  }
  sync_queue: {
    key: number
    value: SyncOp
    indexes: { by_next: number; by_report: string }
  }
  device_settings: {
    key: string
    value: DeviceSettingRecord
  }
  catalogs: {
    key: CatalogKey
    value: CatalogRecord
  }
  work_types_local: {
    key: string
    value: LocalWorkType
  }
  work_assignments_local: {
    key: string
    value: LocalWorkAssignment
  }
  remote_reports_cache: {
    key: string
    value: RemoteReportSnapshot
    indexes: { by_project: string; by_created: string }
  }
  report_mutations: {
    key: number
    value: ReportMutation
    indexes: { by_report: string }
  }
  photo_deletes: {
    key: string
    value: PhotoDeleteRecord
  }
  mark_updates: {
    key: string
    value: MarkUpdateRecord
  }
  auth_session: {
    key: string
    value: AuthSessionRecord
  }
}

let dbPromise: Promise<IDBPDatabase<StroyFotoDB>> | null = null

function ensureStore(
  db: IDBPDatabase<StroyFotoDB>,
  name: string,
  opts: IDBObjectStoreParameters,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: IDBPTransaction<StroyFotoDB, any, 'versionchange'>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (db.objectStoreNames.contains(name as any)) {
    if (tx) {
      const existing = tx.objectStore(name as any)
      const currentKP = existing.keyPath
      const wantKP = opts.keyPath ?? null
      const mismatch =
        (typeof currentKP === 'string' ? currentKP : JSON.stringify(currentKP)) !==
        (typeof wantKP === 'string' ? wantKP : JSON.stringify(wantKP))
      if (mismatch) {
        db.deleteObjectStore(name as any)
        return db.createObjectStore(name as any, opts)
      }
    }
    return null
  }
  return db.createObjectStore(name as any, opts)
}

const DB_VERSION = 88

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<StroyFotoDB>('stroyfoto', DB_VERSION, {
      upgrade(db, oldVersion, newVersion, tx) {
        // v1 stores
        const reportsNew = ensureStore(db, 'reports', { keyPath: 'id' }, tx)
        if (reportsNew) {
          reportsNew.createIndex('by_status', 'syncStatus')
          reportsNew.createIndex('by_created', 'createdAt')
        }

        const photosNew = ensureStore(db, 'photos', { keyPath: 'id' }, tx)
        if (photosNew) {
          photosNew.createIndex('by_report', 'reportId')
        }

        ensureStore(db, 'plan_marks', { keyPath: 'reportId' }, tx)
        ensureStore(db, 'plans_cache', { keyPath: 'id' }, tx)

        const queueNew = ensureStore(db, 'sync_queue', {
          keyPath: 'id',
          autoIncrement: true,
        }, tx)
        if (queueNew) {
          queueNew.createIndex('by_next', 'nextAttemptAt')
        }

        // v2 stores
        ensureStore(db, 'device_settings', { keyPath: 'key' }, tx)
        ensureStore(db, 'catalogs', { keyPath: 'key' }, tx)

        // v3 stores
        ensureStore(db, 'work_types_local', { keyPath: 'id' }, tx)
        ensureStore(db, 'work_assignments_local', { keyPath: 'id' }, tx)

        const mutationsNew = ensureStore(db, 'report_mutations', {
          keyPath: 'id',
          autoIncrement: true,
        }, tx)
        if (mutationsNew) {
          mutationsNew.createIndex('by_report', 'reportId')
        }

        // v4 stores — edit photos/marks
        ensureStore(db, 'photo_deletes', { keyPath: 'id' }, tx)
        ensureStore(db, 'mark_updates', { keyPath: 'reportId' }, tx)

        // auth_session: refresh-токен (v87+); v88 — переименование r2Key → objectKey
        ensureStore(db, 'auth_session', { keyPath: 'key' }, tx)

        const remoteNew = ensureStore(db, 'remote_reports_cache', { keyPath: 'id' }, tx)
        if (remoteNew) {
          remoteNew.createIndex('by_project', 'projectId')
          remoteNew.createIndex('by_created', 'createdAt')
        }

        // Ensure indexes that may be missing on pre-existing stores
        const queue = tx.objectStore('sync_queue')
        if (!queue.indexNames.contains('by_report')) {
          queue.createIndex('by_report', 'reportId')
        }

        const photos = tx.objectStore('photos')
        if (!photos.indexNames.contains('by_origin')) {
          photos.createIndex('by_origin', 'origin')
        }

        // Migrate existing photos without origin field
        if (oldVersion > 0 && oldVersion < DB_VERSION) {
          void photos.openCursor().then(async function migrate(cursor): Promise<void> {
            if (!cursor) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = cursor.value as any
            const patch: Record<string, unknown> = {}
            if (!v.origin) patch.origin = 'local'
            // v88: r2Key → objectKey, thumbR2Key → thumbObjectKey
            if (v.r2Key !== undefined) {
              patch.objectKey = v.r2Key
              patch.r2Key = undefined
            }
            if (v.thumbR2Key !== undefined) {
              patch.thumbObjectKey = v.thumbR2Key
              patch.thumbR2Key = undefined
            }
            if (Object.keys(patch).length > 0) {
              const next = { ...v, ...patch }
              delete next.r2Key
              delete next.thumbR2Key
              cursor.update(next)
            }
            const nextCursor = await cursor.continue()
            return migrate(nextCursor)
          })

          // v88: photo_deletes — переносим r2Key/thumbR2Key → objectKey/thumbObjectKey, убираем storage
          if (db.objectStoreNames.contains('photo_deletes' as never)) {
            const pdStore = tx.objectStore('photo_deletes')
            void pdStore.openCursor().then(async function migrate(cursor): Promise<void> {
              if (!cursor) return
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const v = cursor.value as any
              if (v.r2Key !== undefined || v.thumbR2Key !== undefined || v.storage !== undefined) {
                const next = { ...v }
                if (v.r2Key !== undefined) { next.objectKey = v.r2Key; delete next.r2Key }
                if (v.thumbR2Key !== undefined) { next.thumbObjectKey = v.thumbR2Key; delete next.thumbR2Key }
                if (v.storage !== undefined) delete next.storage
                cursor.update(next)
              }
              const nextCursor = await cursor.continue()
              return migrate(nextCursor)
            })
          }

          // v88: remote_reports_cache — фото-метаданные тоже переименовываем
          if (db.objectStoreNames.contains('remote_reports_cache' as never)) {
            const rcStore = tx.objectStore('remote_reports_cache')
            void rcStore.openCursor().then(async function migrate(cursor): Promise<void> {
              if (!cursor) return
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const v = cursor.value as any
              if (Array.isArray(v.photos) && v.photos.length > 0) {
                let dirty = false
                const photosNext = v.photos.map((p: Record<string, unknown>) => {
                  if (p.r2Key !== undefined || p.thumbR2Key !== undefined || p.storage !== undefined) {
                    dirty = true
                    const next: Record<string, unknown> = { ...p }
                    if (p.r2Key !== undefined) { next.objectKey = p.r2Key; delete next.r2Key }
                    if (p.thumbR2Key !== undefined) { next.thumbObjectKey = p.thumbR2Key; delete next.thumbR2Key }
                    if (p.storage !== undefined) delete next.storage
                    return next
                  }
                  return p
                })
                if (dirty) cursor.update({ ...v, photos: photosNext })
              }
              const nextCursor = await cursor.continue()
              return migrate(nextCursor)
            })
          }
        }

        // Диагностика keyPath критических stores — помогает быстро подтвердить,
        // что схема восстановилась после ветки mismatch в ensureStore.
        try {
          const critical = ['reports', 'photos', 'plan_marks', 'sync_queue']
          const parts = critical.map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (name) => `${name}.keyPath=${JSON.stringify(tx.objectStore(name as any).keyPath)}`,
          )
          console.info(`[idb upgrade] oldVersion=${oldVersion} newVersion=${newVersion} ${parts.join(' ')}`)
        } catch (e) {
          console.warn('[idb upgrade] diagnostic failed:', e)
        }
      },
      blocked(currentVersion, blockedVersion) {
        console.warn(
          `[idb] upgrade blocked: другая вкладка держит БД на версии ${currentVersion}, ` +
            `новая версия ${blockedVersion}. Закройте другие вкладки приложения.`,
        )
        window.dispatchEvent(new CustomEvent('stroyfoto:idb-blocked', {
          detail: { currentVersion, blockedVersion },
        }))
      },
      blocking(currentVersion, blockedVersion) {
        console.warn(
          `[idb] this tab is blocking upgrade (current=${currentVersion}, blocked=${blockedVersion}); closing connection`,
        )
        // Закрываем текущее соединение, чтобы другая вкладка могла завершить upgrade.
        void dbPromise?.then((db) => db.close())
        dbPromise = null
      },
    })
  }
  return dbPromise
}
