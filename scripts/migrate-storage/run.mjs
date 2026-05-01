// Команда `run` — основной перенос объектов из R2 в Cloud.ru.
//
// Логика по одной строке (и фото, и план):
//   1. HEAD на Cloud.ru — если объект уже там И DB-row помечен r2,
//      просто обновляем БД на cloudru (skip-copy).
//   2. GET с R2 → PUT в Cloud.ru (тот же object key) → mark в БД.
//   3. Любая ошибка фиксируется в migration-errors.jsonl (JSONL),
//      обработка следующих строк продолжается.
//
// Параллелизм: --concurrency N (default 4). Конкретные задачи распределяются
// через простой work-pool на async-генераторе.
//
// Идемпотентность гарантируется HEAD'ом + UPDATE WHERE storage='r2'.

import { loadEnv } from './env.mjs'
import { StorageClient } from './storage.mjs'
import {
  countByStorage,
  createServiceClient,
  iterPhotosToMigrate,
  iterPlansToMigrate,
  markPhotoMigrated,
  markPlanMigrated,
} from './db.mjs'
import { log } from './log.mjs'

const DEFAULT_CONCURRENCY = 4
const DEFAULT_RETRIES = 3

export async function runCommand(args) {
  log.header('Миграция R2 → Cloud.ru')

  const concurrency = clampInt(args.concurrency, 1, 32, DEFAULT_CONCURRENCY)
  const retries = clampInt(args.retries, 0, 10, DEFAULT_RETRIES)
  const limit = args.limit != null ? Number(args.limit) : Infinity
  const dryRun = !!args.dryRun
  const onlyKind = args.only ?? 'all' // 'photos' | 'plans' | 'all'

  log.bullet(`concurrency = ${concurrency}`)
  log.bullet(`retries     = ${retries} (с экспоненциальным backoff)`)
  log.bullet(`limit       = ${Number.isFinite(limit) ? limit : 'без ограничений'}`)
  log.bullet(`dry-run     = ${dryRun}`)
  log.bullet(`only        = ${onlyKind}`)

  const env = loadEnv({ config: args.config })
  const supabase = createServiceClient(env.supabase)
  const r2 = new StorageClient({ ...env.r2, label: 'R2' })
  const cloudru = new StorageClient({ ...env.cloudru, label: 'Cloud.ru' })

  // Сводный счётчик. Объект — каждый бинарь (фото = full + thumb, план = 1).
  const stats = {
    objectsTotal: 0,
    objectsCopied: 0,
    objectsAlreadyOnCloudru: 0,
    objectsFailed: 0,
    rowsUpdated: 0,
    rowsRaceLost: 0,
    bytesCopied: 0,
  }

  // Заранее посчитаем объём, чтобы прогресс-бар был информативным.
  if (onlyKind !== 'plans') {
    const photoRows = await countByStorage(supabase, 'report_photos', 'r2')
    stats.objectsTotal += photoRows * 2
  }
  if (onlyKind !== 'photos') {
    const planRows = await countByStorage(supabase, 'plans', 'r2')
    stats.objectsTotal += planRows
  }
  log.bullet(`Объектов в очереди: ${stats.objectsTotal}`)

  if (stats.objectsTotal === 0) {
    log.success('Всё уже на Cloud.ru — переносить нечего.')
    return 0
  }

  const progress = log.progress('progress')
  let processedRows = 0

  const renderProgress = () => {
    const done = stats.objectsCopied + stats.objectsAlreadyOnCloudru + stats.objectsFailed
    const pct = stats.objectsTotal > 0 ? ((done / stats.objectsTotal) * 100).toFixed(1) : '0.0'
    const mb = (stats.bytesCopied / (1024 * 1024)).toFixed(1)
    progress.update(
      `${done}/${stats.objectsTotal} (${pct}%)  copied=${stats.objectsCopied}  ` +
        `skip=${stats.objectsAlreadyOnCloudru}  fail=${stats.objectsFailed}  ${mb}MB`,
    )
  }

  // Аккумулируем работу из БД и раздаём worker'ам.
  if (onlyKind !== 'plans') {
    log.bullet('Перенос фотографий...')
    for await (const batch of iterPhotosToMigrate(supabase)) {
      if (processedRows >= limit) break
      const slice = batch.slice(0, Math.max(0, limit - processedRows))
      await runPool(slice, concurrency, async (row) => {
        if (processedRows >= limit) return
        await migratePhotoRow({
          row, r2, cloudru, supabase, stats, dryRun, retries, renderProgress,
        })
        processedRows += 1
      })
    }
  }

  if (onlyKind !== 'photos') {
    log.bullet('Перенос планов...')
    for await (const batch of iterPlansToMigrate(supabase)) {
      if (processedRows >= limit) break
      const slice = batch.slice(0, Math.max(0, limit - processedRows))
      await runPool(slice, concurrency, async (row) => {
        if (processedRows >= limit) return
        await migratePlanRow({
          row, r2, cloudru, supabase, stats, dryRun, retries, renderProgress,
        })
        processedRows += 1
      })
    }
  }

  progress.done()

  // Финальная сводка.
  log.header('Итог миграции')
  log.raw(`  Объектов всего:        ${stats.objectsTotal}`)
  log.raw(`  Скопировано:           ${stats.objectsCopied}`)
  log.raw(`  Уже было на Cloud.ru:  ${stats.objectsAlreadyOnCloudru}`)
  log.raw(`  Не удалось перенести:  ${stats.objectsFailed}`)
  log.raw(`  Байт скопировано:      ${stats.bytesCopied} (${(stats.bytesCopied / 1024 / 1024).toFixed(2)} MB)`)
  log.raw(`  Строк обновлено в БД:  ${stats.rowsUpdated}`)
  log.raw(`  Race-lost (кто-то опередил): ${stats.rowsRaceLost}`)
  log.raw('')
  log.bullet(`Лог ошибок: ${log.errorsLogPath()}`)

  if (stats.objectsFailed > 0) {
    log.warn(`${stats.objectsFailed} объектов с ошибками. Запустите run ещё раз — миграция идемпотентна.`)
    return 2
  }
  if (dryRun) {
    log.warn('DRY-RUN: ни один объект не переписан, БД не обновлена.')
    return 0
  }
  log.success('Миграция завершена. Запустите `npm run migrate:storage:verify`.')
  return 0
}

/**
 * Простой work-pool: гонит N worker'ов, каждый по очереди берёт следующий
 * элемент из items[]. Возвращает после обработки всех элементов.
 */
async function runPool(items, concurrency, worker) {
  if (items.length === 0) return
  let cursor = 0
  const lanes = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    lanes.push((async () => {
      while (true) {
        const idx = cursor++
        if (idx >= items.length) return
        await worker(items[idx])
      }
    })())
  }
  await Promise.all(lanes)
}

async function migratePhotoRow(ctx) {
  const { row, r2, cloudru, supabase, stats, dryRun, retries, renderProgress } = ctx
  // Каждое фото = 2 объекта (full + thumb), но БД-row один. Помечаем
  // строку только когда оба объекта успешно лежат в Cloud.ru.
  const objects = [
    { kind: 'photo', key: row.r2_key, contentType: 'image/jpeg' },
  ]
  if (row.thumb_r2_key) {
    objects.push({ kind: 'photo_thumb', key: row.thumb_r2_key, contentType: 'image/jpeg' })
  }

  let allOk = true
  for (const obj of objects) {
    const ok = await copyOneObject({
      ...ctx,
      key: obj.key,
      contentType: obj.contentType,
      kind: obj.kind,
      rowId: row.id,
      table: 'report_photos',
    })
    if (!ok) allOk = false
    renderProgress()
  }

  if (!allOk) return

  if (dryRun) return
  try {
    const updated = await markPhotoMigrated(supabase, row.id)
    if (updated > 0) stats.rowsUpdated += 1
    else stats.rowsRaceLost += 1
  } catch (e) {
    log.recordError({
      table: 'report_photos',
      rowId: row.id,
      step: 'markMigrated',
      error: e instanceof Error ? e.message : String(e),
    })
    log.error(`update report_photos ${row.id}`, e)
  }
}

async function migratePlanRow(ctx) {
  const { row, supabase, stats, dryRun, renderProgress } = ctx
  const ok = await copyOneObject({
    ...ctx,
    key: row.r2_key,
    contentType: 'application/pdf',
    kind: 'plan',
    rowId: row.id,
    table: 'plans',
  })
  renderProgress()
  if (!ok) return

  if (dryRun) return
  try {
    const updated = await markPlanMigrated(supabase, row.id)
    if (updated > 0) stats.rowsUpdated += 1
    else stats.rowsRaceLost += 1
  } catch (e) {
    log.recordError({
      table: 'plans',
      rowId: row.id,
      step: 'markMigrated',
      error: e instanceof Error ? e.message : String(e),
    })
    log.error(`update plans ${row.id}`, e)
  }
}

/**
 * Копирует один объект. Сначала HEAD на Cloud.ru — если уже там,
 * пропускаем GET/PUT (skip-copy). Иначе GET с R2 + PUT в Cloud.ru.
 *
 * Возвращает true при успехе, false при фатальной ошибке (записанной в JSONL).
 */
async function copyOneObject({
  r2, cloudru, stats, dryRun, retries, key, contentType, kind, rowId, table,
}) {
  // 1. Уже на Cloud.ru?
  try {
    const head = await withRetry(retries, () => cloudru.head(key))
    if (head.exists) {
      stats.objectsAlreadyOnCloudru += 1
      return true
    }
  } catch (e) {
    log.recordError({
      table, rowId, key, kind, step: 'cloudruHead',
      error: e instanceof Error ? e.message : String(e),
    })
    stats.objectsFailed += 1
    return false
  }

  if (dryRun) {
    // dry-run всё равно засчитывает как «было бы скопировано», но
    // без реальной заливки.
    stats.objectsCopied += 1
    return true
  }

  // 2. GET с R2
  let body
  try {
    const got = await withRetry(retries, () => r2.get(key))
    body = got.body
    stats.bytesCopied += got.size
  } catch (e) {
    log.recordError({
      table, rowId, key, kind, step: 'r2Get',
      error: e instanceof Error ? e.message : String(e),
    })
    stats.objectsFailed += 1
    return false
  }

  // 3. PUT в Cloud.ru
  try {
    await withRetry(retries, () => cloudru.put(key, body, contentType))
    stats.objectsCopied += 1
    return true
  } catch (e) {
    log.recordError({
      table, rowId, key, kind, step: 'cloudruPut',
      error: e instanceof Error ? e.message : String(e),
    })
    stats.objectsFailed += 1
    return false
  }
}

/**
 * Простая обёртка для retry с экспоненциальным backoff + jitter.
 * 5xx и сетевые ошибки — ретраим, остальное (в т.ч. 4xx) — нет.
 */
async function withRetry(maxRetries, fn) {
  let lastErr = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt === maxRetries) break
      const msg = e instanceof Error ? e.message : String(e)
      const transient = /5\d{2}|fetch|network|timeout|aborterror|ECONN|ETIMEDOUT/i.test(msg)
      if (!transient) break
      const delay = Math.min(15_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250)
      await sleep(delay)
    }
  }
  throw lastErr ?? new Error('unknown error')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampInt(v, min, max, def) {
  if (v == null) return def
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, Math.floor(n)))
}
