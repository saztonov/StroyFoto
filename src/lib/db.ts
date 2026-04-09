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

export interface LocalPhoto {
  id: string
  reportId: string
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  takenAt: string | null
  order: number
  syncStatus: SyncStatus
  r2Key?: string | null
  thumbR2Key?: string | null
}

export interface LocalPlanMark {
  reportId: string
  planId: string
  page: number
  xNorm: number
  yNorm: number
  syncStatus: SyncStatus
}

export type SyncOpKind = 'report' | 'mark' | 'photo'

export interface SyncOp {
  id?: number
  kind: SyncOpKind
  entityId: string
  attempts: number
  nextAttemptAt: number
  lastError: string | null
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
    indexes: { by_report: string }
  }
  plan_marks: {
    key: string
    value: LocalPlanMark
  }
  plans_cache: {
    key: string
    value: { id: string; blob: Blob }
  }
  sync_queue: {
    key: number
    value: SyncOp
    indexes: { by_next: number }
  }
  device_settings: {
    key: string
    value: DeviceSettingRecord
  }
  catalogs: {
    key: CatalogKey
    value: CatalogRecord
  }
}

let dbPromise: Promise<IDBPDatabase<StroyFotoDB>> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<StroyFotoDB>('stroyfoto', 2, {
      upgrade(db, oldVersion) {
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
      },
    })
  }
  return dbPromise
}
