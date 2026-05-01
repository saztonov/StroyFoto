import { supabase } from '@/lib/supabase'
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
 *  1. Найти в Supabase все строки `report_photos` / `plans` с `storage='r2'`.
 *  2. Для каждой:
 *      - Запросить у Edge Function presigned GET (provider='r2'), скачать blob.
 *      - Запросить presigned PUT (provider='cloudru'), залить blob в Cloud.ru.
 *      - Обновить колонку `storage` в Supabase на 'cloudru'.
 *  3. Если что-то падает — оставляем `storage='r2'`, повторный запуск
 *     перенесёт оставшееся. Object key не меняется, так что повторная
 *     заливка просто перезапишет уже скопированный объект.
 *
 * Доступ к R2 разрешён в Edge Function только администратору и только
 * для GET (см. checkAccess в supabase/functions/sign/index.ts).
 *
 * Миграция выполняется последовательно — экономим память на мобильных и не
 * отстреливаем себя rate-limit'ом Edge Function. Параллелизм можно поднять
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
  const [photos, plans] = await Promise.all([
    countRowsByStorage('report_photos', 'r2'),
    countRowsByStorage('plans', 'r2'),
  ])
  // Photo row → full + thumb (если thumb_r2_key задан, что норма для всех новых)
  // Plan row → 1 объект.
  return {
    totalRows: photos + plans,
    totalObjects: photos * 2 + plans,
    doneObjects: 0,
    errorObjects: 0,
  }
}

async function countRowsByStorage(
  table: 'report_photos' | 'plans',
  storage: StorageProvider,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('storage', storage)
  if (error) throw new Error(`${table} count: ${error.message}`)
  return count ?? 0
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
    const { data, error } = await supabase
      .from('report_photos')
      .select('id, report_id, r2_key, thumb_r2_key, storage')
      .eq('storage', 'r2')
      .limit(PAGE_SIZE)
    if (error) {
      log(onProgress, stats, 'error', `report_photos page: ${error.message}`)
      throw new Error(error.message)
    }
    const rows = (data as PhotoRow[] | null) ?? []
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
  const { error } = await supabase
    .from('report_photos')
    .update({ storage: 'cloudru' })
    .eq('id', row.id)
    .eq('storage', 'r2') // защита от гонки
  if (error) throw new Error(`update row: ${error.message}`)
}

async function migratePlans(
  stats: MigrationStats,
  onProgress: (event: MigrationProgressEvent) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  while (!abortSignal.aborted) {
    const { data, error } = await supabase
      .from('plans')
      .select('id, project_id, r2_key, storage')
      .eq('storage', 'r2')
      .limit(PAGE_SIZE)
    if (error) {
      log(onProgress, stats, 'error', `plans page: ${error.message}`)
      throw new Error(error.message)
    }
    const rows = (data as PlanRow[] | null) ?? []
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

  const { error } = await supabase
    .from('plans')
    .update({ storage: 'cloudru' })
    .eq('id', row.id)
    .eq('storage', 'r2')
  if (error) throw new Error(`update row: ${error.message}`)
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
