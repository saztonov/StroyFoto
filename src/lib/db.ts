import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

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

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<StroyFotoDB>('stroyfoto', 3, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const reports = db.createObjectStore('reports', { keyPath: 'id' })
          reports.createIndex('by_status', 'syncStatus')
          reports.createIndex('by_created', 'createdAt')

          const photos = db.createObjectStore('photos', { keyPath: 'id' })
          photos.createIndex('by_report', 'reportId')

          db.createObjectStore('plan_marks', { keyPath: 'reportId' })
          db.createObjectStore('plans_cache', { keyPath: 'id' })

          const queue = db.createObjectStore('sync_queue', {
            keyPath: 'id',
            autoIncrement: true,
          })
          queue.createIndex('by_next', 'nextAttemptAt')
        }

        if (oldVersion < 2) {
          db.createObjectStore('device_settings', { keyPath: 'key' })
          db.createObjectStore('catalogs', { keyPath: 'key' })
        }

        if (oldVersion < 3) {
          db.createObjectStore('work_types_local', { keyPath: 'id' })

          const remote = db.createObjectStore('remote_reports_cache', { keyPath: 'id' })
          remote.createIndex('by_project', 'projectId')
          remote.createIndex('by_created', 'createdAt')

          // sync_queue: новый индекс by_report для быстрой проверки
          // "есть ли незавершённые задачи у этого отчёта" (retention + aggregation)
          const queue = tx.objectStore('sync_queue')
          if (!queue.indexNames.contains('by_report')) {
            queue.createIndex('by_report', 'reportId')
          }

          // photos: индекс по origin для отдельной политики очистки remote-кэша
          const photos = tx.objectStore('photos')
          if (!photos.indexNames.contains('by_origin')) {
            photos.createIndex('by_origin', 'origin')
          }

          // Мигрируем существующие local-фото: помечаем origin='local'.
          // Это важно, потому что applyRetention в новой версии использует
          // origin для различения пользовательских drafts и remote-кэша.
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
