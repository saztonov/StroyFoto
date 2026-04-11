import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'pending_upload'

export interface LocalReport {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  createdAt: string
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
  r2Key?: string | null
  thumbR2Key?: string | null
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

export type SyncOpKind = 'report' | 'mark' | 'photo' | 'work_type'

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
 * Снимок отчёта, прочитанного с сервера. Используется только для
 * offline-просмотра истории; retention чистит эти записи по device
 * setting, но никогда не трогает локальные drafts в store `reports`.
 */
export interface RemoteReportSnapshot {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  authorName: string | null
  createdAt: string
  cachedAt: number
  // фото-метаданные хранятся здесь, бинарные blobs — в store `photos` c origin='remote'
  photos: Array<{
    id: string
    r2Key: string
    thumbR2Key: string | null
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

export type CatalogKey = 'projects' | 'work_types' | 'performers' | 'plans'

export interface CatalogRecord {
  key: CatalogKey
  payload: unknown
  updatedAt: number
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
  remote_reports_cache: {
    key: string
    value: RemoteReportSnapshot
    indexes: { by_project: string; by_created: string }
  }
}

let dbPromise: Promise<IDBPDatabase<StroyFotoDB>> | null = null

function ensureStore(
  db: IDBPDatabase<StroyFotoDB>,
  name: string,
  opts: IDBObjectStoreParameters,
  tx?: IDBPTransaction<StroyFotoDB, (keyof StroyFotoDB)[], 'versionchange'>,
) {
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

const DB_VERSION = 82

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<StroyFotoDB>('stroyfoto', DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
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
            const v = cursor.value as LocalPhoto
            if (!v.origin) {
              cursor.update({ ...v, origin: 'local' })
            }
            const next = await cursor.continue()
            return migrate(next)
          })
        }
      },
    })
  }
  return dbPromise
}
