// Команда `verify` — проверяет консистентность после миграции.
//
// Что проверяем:
//   1. Не осталось строк со storage='r2' (ожидается 0 после успешного run).
//   2. Для всех (или sample N) строк со storage='cloudru' объекты реально
//      лежат в Cloud.ru (HEAD).
//   3. Опционально: --compare-r2 — для каждой проверяемой строки HEAD'аем
//      объект и в R2, сравниваем размеры. Полезно убедиться, что данные
//      переехали 1:1, прежде чем удалять R2.
//
// Никаких изменений в данных НЕ делается. Exit code 0 = всё ок,
// 1 = найдены проблемы.

import { loadEnv } from './env.mjs'
import { StorageClient } from './storage.mjs'
import {
  countByStorage,
  createServiceClient,
  iterPhotosOn,
  iterPlansOn,
} from './db.mjs'
import { log } from './log.mjs'

const DEFAULT_CONCURRENCY = 8

export async function verifyCommand(args) {
  log.header('Verify: проверка после миграции')

  const concurrency = clampInt(args.concurrency, 1, 32, DEFAULT_CONCURRENCY)
  const sampleSize = args.sample != null ? Number(args.sample) : null
  const compareR2 = !!args.compareR2

  log.bullet(`concurrency = ${concurrency}`)
  log.bullet(`sample      = ${sampleSize ? sampleSize : 'все строки'}`)
  log.bullet(`compare-r2  = ${compareR2}`)

  const env = loadEnv({ config: args.config })
  const supabase = createServiceClient(env.supabase)
  const r2 = new StorageClient({ ...env.r2, label: 'R2' })
  const cloudru = new StorageClient({ ...env.cloudru, label: 'Cloud.ru' })

  // 1. Должно быть 0 строк со storage=r2
  const [photosR2, plansR2] = await Promise.all([
    countByStorage(supabase, 'report_photos', 'r2'),
    countByStorage(supabase, 'plans', 'r2'),
  ])
  log.bullet(`Осталось со storage=r2:  фото=${photosR2}, планы=${plansR2}`)
  if (photosR2 + plansR2 > 0) {
    log.warn(
      'Есть строки со storage=r2 — миграция не завершена. ' +
        'Запустите `npm run migrate:storage:run` ещё раз.',
    )
  }

  const [photosCloudru, plansCloudru] = await Promise.all([
    countByStorage(supabase, 'report_photos', 'cloudru'),
    countByStorage(supabase, 'plans', 'cloudru'),
  ])
  log.bullet(`Помечено как cloudru:    фото=${photosCloudru}, планы=${plansCloudru}`)

  const stats = {
    objectsChecked: 0,
    objectsOk: 0,
    objectsMissing: 0,
    objectsSizeMismatch: 0,
    objectsR2Missing: 0,
  }

  const progress = log.progress('verify')
  const renderProgress = () =>
    progress.update(
      `${stats.objectsChecked} checked  ok=${stats.objectsOk}  ` +
        `missing=${stats.objectsMissing}  mismatch=${stats.objectsSizeMismatch}` +
        (compareR2 ? `  r2-missing=${stats.objectsR2Missing}` : ''),
    )

  // 2. Проверка фото
  log.bullet('Проверка фотографий...')
  let processed = 0
  outerPhotos: for await (const batch of iterPhotosOn(supabase, 'cloudru')) {
    const slice = sampleSize ? sampleRows(batch, sampleSize - processed) : batch
    if (slice.length === 0) break
    processed += slice.length
    await runPool(slice, concurrency, async (row) => {
      await checkOne({
        cloudru, r2, compareR2, stats, key: row.r2_key, kind: 'photo',
        rowId: row.id, table: 'report_photos',
      })
      renderProgress()
      if (row.thumb_r2_key) {
        await checkOne({
          cloudru, r2, compareR2, stats, key: row.thumb_r2_key, kind: 'photo_thumb',
          rowId: row.id, table: 'report_photos',
        })
        renderProgress()
      }
    })
    if (sampleSize && processed >= sampleSize) break outerPhotos
  }

  // 3. Проверка планов
  log.bullet('Проверка планов...')
  processed = 0
  outerPlans: for await (const batch of iterPlansOn(supabase, 'cloudru')) {
    const slice = sampleSize ? sampleRows(batch, sampleSize - processed) : batch
    if (slice.length === 0) break
    processed += slice.length
    await runPool(slice, concurrency, async (row) => {
      await checkOne({
        cloudru, r2, compareR2, stats, key: row.r2_key, kind: 'plan',
        rowId: row.id, table: 'plans',
      })
      renderProgress()
    })
    if (sampleSize && processed >= sampleSize) break outerPlans
  }

  progress.done()

  log.header('Итог проверки')
  log.raw(`  Объектов проверено:        ${stats.objectsChecked}`)
  log.raw(`  Доступны на Cloud.ru:      ${stats.objectsOk}`)
  log.raw(`  Отсутствуют на Cloud.ru:   ${stats.objectsMissing}`)
  log.raw(`  Размер не совпадает:       ${stats.objectsSizeMismatch}`)
  if (compareR2) {
    log.raw(`  Отсутствуют в R2 (info):   ${stats.objectsR2Missing}`)
  }
  log.raw('')

  const hasIssues =
    photosR2 + plansR2 > 0 ||
    stats.objectsMissing > 0 ||
    stats.objectsSizeMismatch > 0

  if (!hasIssues) {
    log.success('Verify OK — данные на Cloud.ru консистентны с БД.')
    if (compareR2 && stats.objectsR2Missing > 0) {
      log.warn(
        `${stats.objectsR2Missing} объектов уже отсутствуют в R2 (норма после удаления R2-бакета).`,
      )
    }
    log.bullet(`Лог ошибок (если был): ${log.errorsLogPath()}`)
    return 0
  }
  log.error('Verify НЕ ПРОЙДЕН. См. подробности выше и в JSONL-логе.')
  log.bullet(`Лог ошибок: ${log.errorsLogPath()}`)
  return 1
}

async function checkOne({
  cloudru, r2, compareR2, stats, key, kind, rowId, table,
}) {
  stats.objectsChecked += 1

  let cloudruHead
  try {
    cloudruHead = await cloudru.head(key)
  } catch (e) {
    log.recordError({
      table, rowId, key, kind, step: 'verifyCloudruHead',
      error: e instanceof Error ? e.message : String(e),
    })
    stats.objectsMissing += 1
    return
  }

  if (!cloudruHead.exists) {
    stats.objectsMissing += 1
    log.recordError({
      table, rowId, key, kind, step: 'verifyCloudruMissing',
      error: 'объект помечен как cloudru, но в Cloud.ru его нет',
    })
    return
  }

  if (compareR2) {
    let r2Head
    try {
      r2Head = await r2.head(key)
    } catch (e) {
      log.recordError({
        table, rowId, key, kind, step: 'verifyR2Head',
        error: e instanceof Error ? e.message : String(e),
      })
      stats.objectsR2Missing += 1
    }
    if (r2Head && !r2Head.exists) {
      stats.objectsR2Missing += 1
    }
    if (r2Head?.exists && cloudruHead.size !== r2Head.size) {
      stats.objectsSizeMismatch += 1
      log.recordError({
        table, rowId, key, kind, step: 'verifySizeMismatch',
        error: `cloudru.size=${cloudruHead.size} ≠ r2.size=${r2Head.size}`,
      })
      return
    }
  }

  stats.objectsOk += 1
}

function sampleRows(arr, remaining) {
  if (remaining <= 0) return []
  if (arr.length <= remaining) return arr
  // Случайная выборка без замены — Fisher–Yates partial.
  const out = arr.slice()
  for (let i = 0; i < remaining; i++) {
    const j = i + Math.floor(Math.random() * (out.length - i))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, remaining)
}

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

function clampInt(v, min, max, def) {
  if (v == null) return def
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, Math.floor(n)))
}
