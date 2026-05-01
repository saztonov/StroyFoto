import type { SyncStatus } from '@/lib/db'
import type { StorageProvider } from '@/services/r2'

/**
 * Унифицированная карточка отчёта для списка/детальной страницы.
 * `remoteOnly = true` означает, что отчёт ещё не сохранён в IndexedDB на этом
 * устройстве как черновик — это либо свежая запись с сервера, либо кэш истории.
 */
export interface ReportCard {
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
  syncStatus: SyncStatus
  remoteOnly: boolean
}

export interface RemoteReportRow {
  id: string
  project_id: string
  work_type_id: string
  performer_id: string
  work_assignment_id: string | null
  plan_id: string | null
  description: string | null
  taken_at: string | null
  author_id: string
  created_at: string
  updated_at: string | null
}

export interface RemoteReportPhoto {
  id: string
  r2_key: string
  thumb_r2_key: string
  width: number | null
  height: number | null
  taken_at: string | null
  /**
   * В каком хранилище лежат бинарные объекты. До миграции на Cloud.ru у
   * исторических фото значение 'r2'; после — 'cloudru'. Может отсутствовать
   * в кэше старых снимков → читать как 'cloudru'.
   */
  storage?: StorageProvider
}

export interface RemoteReportMark {
  plan_id: string
  page: number
  x_norm: number
  y_norm: number
}

export interface RemoteReportRowWithNested extends RemoteReportRow {
  report_photos: RemoteReportPhoto[] | null
  report_plan_marks: RemoteReportMark[] | null
}

export interface RemoteReportFull {
  card: ReportCard
  photos: RemoteReportPhoto[]
  mark: RemoteReportMark | null
  authorName: string | null
}

export interface MergedReportsResult {
  cards: ReportCard[]
  hasMore: boolean
  nextCursor: string | null
}

export interface ReportUpdateInput {
  workTypeId: string
  performerId: string
  workAssignmentId: string | null
  description: string | null
  takenAt: string | null
  planId?: string | null // undefined = не менять, null = убрать
  expectedUpdatedAt?: string | null
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** Таймаут для сетевых запросов при загрузке списка отчётов (мс). */
export const FETCH_TIMEOUT_MS = 5_000
export const PAGE_SIZE = 200
