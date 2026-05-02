import { apiFetch } from '@/lib/apiClient'
import {
  getFromPresigned,
  putToPresigned,
  requestPresigned,
  type StorageProvider,
} from '@/services/r2'

/**
 * ============================================================================
 * Перенос объектов из Cloudflare R2 в Cloud.ru Object Storage.
 * ============================================================================
 *
 * Логика проста и идемпотентна:
 *  1. Найти на backend все строки `report_photos` / `plans` с `storage='r2'`.
 *  2. Для каждой:
 *      - Запросить у `/api/storage/presign` presigned GET (provider='r2'),
 *        скачать blob.
 *      - Запросить presigned PUT (provider='cloudru'), залить blob в Cloud.ru.
 *      - Обновить колонку `storage` через backend на 'cloudru'.
 *  3. Если что-то падает — оставляем `storage='r2'`, повторный запуск
 *     перенесёт оставшееся. Object key не меняется, так что повторная
 *     заливка просто перезапишет уже скопированный объект.
 *
 * Доступ к R2 разрешён в backend `/api/storage/presign` только администратору
 * и только для GET (PUT в R2 запрещён всегда — см. presignService.ts).
 *
 * Миграция выполняется последовательно — экономим память на мобильных и не
 * отстреливаем себя rate-limit'ом backend. Параллелизм можно поднять
 * аккуратной батч-обработкой, но MVP-цена/польза не стоит того.
 */

export interface MigrationItem {
  kind: 'photo' | 'photo_thumb' | 'plan'
  rowId: string // photo.id или plan.id (для UI)
  reportId?: string // для photo / photo_thumb
  projectId?: string // для plan
  planId?: string // для plan
  key: string
  contentType: 'image/jpeg' | 'application/pdf'
  /**
   * Какой колонке БД эта запись принадлежит. Один photo row → две задачи
   * (photo + photo_thumb), но `storage` одна → обновляем один раз
   * после загрузки thumb (а до этого — после full).
   */
  source: 'photo_row' | 'plan_row'
}

export interface MigrationStats {
  totalRows: number
  totalObjects: number
  doneObjects: number
  errorObjects: number
}

export type MigrationLogLevel = 'info' | 'success' | 'warn' | 'error'
export interface MigrationLogEntry {
  level: MigrationLogLevel
  message: string
  timestamp: number
}

export interface MigrationProgressEvent {
  stats: MigrationStats
  log?: MigrationLogEntry
  /** true, если все строки переехали и больше нет работы. */
  finished?: boolean
}

interface PhotoRow {
  id: string
  report_id: string
  r2_key: string
  thumb_r2_key: string | null
  storage: StorageProvider
}

interface PlanRow {
  id: string
  project_id: string
  r2_key: string
  storage: StorageProvider
}

const PAGE_SIZE = 100

/**
 * Считает оставшиеся объекты на R2 (одна `report_photos`-row может содержать
 * full + thumb, поэтому totalObjects ≠ totalRows).
 */
export async function loadMigrationOverview(): Promise<MigrationStats> {
  const data = await apiFetch<{
    overview: {
      photos_remaining: number
      plans_remaining: number
      photos_done: number
      plans_done: number
    }
  }>('/api/storage-migration/overview')
  const { photos_remaining: photos, plans_remaining: plans } = data.overview
  // Photo row → full + thumb (если thumb_r2_key задан, что норма для всех новых)
  // Plan row → 1 объект.
  return {
    totalRows: photos + plans,
    totalObjects: photos * 2 + plans,
    doneObjects: 0,
    errorObjects: 0,
  }
}

/**
 * Запускает миграцию. abortSignal — для аккуратной остановки между задачами.
 */
export async function runMigration(
  onProgress: (event: MigrationProgressEvent) => void,
  abortSignal: AbortSignal,
): Promise<MigrationStats> {
  const overview = await loadMigrationOverview()
  const stats: MigrationStats = { ...overview }
  onProgress({ stats })

  // Сначала фотки, потом планы.
  await migratePhotos(stats, onProgress, abortSignal)
  if (abortSignal.aborted) return stats
  await migratePlans(stats, onProgress, abortSignal)

  onProgress({ stats, finished: true })
  return stats
}

async function migratePhotos(
  stats: MigrationStats,
  onProgress: (event: MigrationProgressEvent) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  while (!abortSignal.aborted) {
    let rows: PhotoRow[]
    try {
      const data = await apiFetch<{ items: PhotoRow[] }>(
        `/api/storage-migration/photos?storage=r2&limit=${PAGE_SIZE}`,
      )
      rows = data.items
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log(onProgress, stats, 'error', `report_photos page: ${msg}`)
      throw new Error(msg)
    }
    if (rows.length === 0) return

    for (const row of rows) {
      if (abortSignal.aborted) return
      try {
        await migrateOnePhoto(row, abortSignal)
        stats.doneObjects += row.thumb_r2_key ? 2 : 1
        log(onProgress, stats, 'success', `Фото ${row.id} перенесено в Cloud.ru`)
      } catch (e) {
        stats.errorObjects += row.thumb_r2_key ? 2 : 1
        log(onProgress, stats, 'error', `Фото ${row.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

async function migrateOnePhoto(row: PhotoRow, abortSignal: AbortSignal): Promise<void> {
  // 1. Качаем оригинал с R2
  const fullR2 = await requestPresigned({
    op: 'get',
    kind: 'photo',
    key: row.r2_key,
    reportId: row.report_id,
    provider: 'r2',
  })
  abortGuard(abortSignal)
  const fullBlob = await getFromPresigned(fullR2)
  abortGuard(abortSignal)

  // 2. Качаем thumb с R2 (если есть)
  let thumbBlob: Blob | null = null
  if (row.thumb_r2_key) {
    const thumbR2 = await requestPresigned({
      op: 'get',
      kind: 'photo_thumb',
      key: row.thumb_r2_key,
      reportId: row.report_id,
      provider: 'r2',
    })
    abortGuard(abortSignal)
    thumbBlob = await getFromPresigned(thumbR2)
    abortGuard(abortSignal)
  }

  // 3. Заливаем оригинал в Cloud.ru
  const fullCloud = await requestPresigned({
    op: 'put',
    kind: 'photo',
    key: row.r2_key, // тот же object key
    reportId: row.report_id,
    contentType: 'image/jpeg',
    provider: 'cloudru',
  })
  abortGuard(abortSignal)
  await putToPresigned(fullCloud, fullBlob)

  // 4. Заливаем thumb в Cloud.ru
  if (thumbBlob && row.thumb_r2_key) {
    const thumbCloud = await requestPresigned({
      op: 'put',
      kind: 'photo_thumb',
      key: row.thumb_r2_key,
      reportId: row.report_id,
      contentType: 'image/jpeg',
      provider: 'cloudru',
    })
    abortGuard(abortSignal)
    await putToPresigned(thumbCloud, thumbBlob)
  }

  // 5. Помечаем строку как перенесённую
  await apiFetch(`/api/storage-migration/report-photos/${row.id}/storage`, {
    method: 'PATCH',
    body: { storage: 'cloudru', expected_storage: 'r2' },
  })
}

async function migratePlans(
  stats: MigrationStats,
  onProgress: (event: MigrationProgressEvent) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  while (!abortSignal.aborted) {
    let rows: PlanRow[]
    try {
      const data = await apiFetch<{ items: PlanRow[] }>(
        `/api/storage-migration/plans?storage=r2&limit=${PAGE_SIZE}`,
      )
      rows = data.items
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log(onProgress, stats, 'error', `plans page: ${msg}`)
      throw new Error(msg)
    }
    if (rows.length === 0) return

    for (const row of rows) {
      if (abortSignal.aborted) return
      try {
        await migrateOnePlan(row, abortSignal)
        stats.doneObjects += 1
        log(onProgress, stats, 'success', `План ${row.id} перенесён в Cloud.ru`)
      } catch (e) {
        stats.errorObjects += 1
        log(onProgress, stats, 'error', `План ${row.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

async function migrateOnePlan(row: PlanRow, abortSignal: AbortSignal): Promise<void> {
  const fromR2 = await requestPresigned({
    op: 'get',
    kind: 'plan',
    key: row.r2_key,
    projectId: row.project_id,
    planId: row.id,
    provider: 'r2',
  })
  abortGuard(abortSignal)
  const blob = await getFromPresigned(fromR2)
  abortGuard(abortSignal)

  const toCloud = await requestPresigned({
    op: 'put',
    kind: 'plan',
    key: row.r2_key,
    projectId: row.project_id,
    planId: row.id,
    contentType: 'application/pdf',
    provider: 'cloudru',
  })
  abortGuard(abortSignal)
  await putToPresigned(toCloud, blob)

  await apiFetch(`/api/storage-migration/plans/${row.id}/storage`, {
    method: 'PATCH',
    body: { storage: 'cloudru', expected_storage: 'r2' },
  })
}

function abortGuard(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Миграция остановлена пользователем')
  }
}

function log(
  cb: (e: MigrationProgressEvent) => void,
  stats: MigrationStats,
  level: MigrationLogLevel,
  message: string,
): void {
  cb({
    stats,
    log: { level, message, timestamp: Date.now() },
  })
}
