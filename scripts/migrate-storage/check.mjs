// Команда `check` — preflight перед миграцией. Возвращает exit code 0
// если всё ок, 1 если хоть один шаг провалился (для CI/скриптов).
//
// Что проверяем:
//   1. .env.migrate загружен, обязательные переменные есть.
//   2. Подключение к Supabase service-role + наличие колонки `storage`.
//   3. Round-trip к Cloud.ru: PUT/HEAD/GET/DELETE временного объекта в
//      префиксе `_migration-check/<uuid>`.
//   4. Доступность Cloudflare R2: HEAD на одну случайную строку с
//      storage='r2' (если такие есть).
//   5. Сводная статистика: сколько строк/объектов осталось перенести.
//
// Никаких изменений в продовых данных не делается.

import { randomUUID } from 'node:crypto'
import { loadEnv } from './env.mjs'
import { StorageClient } from './storage.mjs'
import {
  countByStorage,
  createServiceClient,
  hasStorageColumn,
  iterPhotosToMigrate,
  iterPlansToMigrate,
} from './db.mjs'
import { log } from './log.mjs'

export async function checkCommand(args) {
  log.header('Preflight check: миграция R2 → Cloud.ru')

  let okSteps = 0
  let failSteps = 0
  const fail = (label, err) => {
    failSteps += 1
    log.error(`✗ ${label}`, err)
  }
  const ok = (label) => {
    okSteps += 1
    log.success(`✓ ${label}`)
  }

  // 1. Env
  let env
  try {
    env = loadEnv({ config: args.config })
    ok('Конфигурация .env.migrate загружена')
    log.bullet(`Supabase: ${env.supabase.url}`)
    log.bullet(`R2 endpoint: ${env.r2.endpoint} (bucket: ${env.r2.bucket})`)
    log.bullet(`Cloud.ru endpoint: ${env.cloudru.endpoint} (bucket: ${env.cloudru.bucket}, region: ${env.cloudru.region})`)
  } catch (e) {
    fail('Конфигурация окружения', e)
    summary(okSteps, failSteps)
    return failSteps === 0 ? 0 : 1
  }

  const supabase = createServiceClient(env.supabase)
  const r2 = new StorageClient({ ...env.r2, label: 'R2' })
  const cloudru = new StorageClient({ ...env.cloudru, label: 'Cloud.ru' })

  // 2. Supabase + колонка storage
  let photosR2 = 0
  let plansR2 = 0
  let photosCloudru = 0
  let plansCloudru = 0

  try {
    const [hasInPhotos, hasInPlans] = await Promise.all([
      hasStorageColumn(supabase, 'report_photos'),
      hasStorageColumn(supabase, 'plans'),
    ])
    if (!hasInPhotos || !hasInPlans) {
      throw new Error(
        'Колонка `storage` отсутствует. Примените миграцию ' +
          'supabase/migrations/20260501_cloudru_storage.sql и повторите.',
      )
    }
    ok('Supabase: колонка `storage` присутствует в report_photos и plans')

    ;[photosR2, plansR2, photosCloudru, plansCloudru] = await Promise.all([
      countByStorage(supabase, 'report_photos', 'r2'),
      countByStorage(supabase, 'plans', 'r2'),
      countByStorage(supabase, 'report_photos', 'cloudru'),
      countByStorage(supabase, 'plans', 'cloudru'),
    ])
    ok(`Supabase: записи прочитаны (фото r2=${photosR2}, plans r2=${plansR2})`)
  } catch (e) {
    fail('Подключение к Supabase / схема', e)
  }

  // 3. Cloud.ru round-trip
  const probeKey = `_migration-check/${randomUUID()}.bin`
  const probePayload = new TextEncoder().encode(
    `stroyfoto migration probe ${new Date().toISOString()}`,
  )
  try {
    await cloudru.put(probeKey, probePayload, 'application/octet-stream')
    ok(`Cloud.ru PUT прошёл (${probeKey}, ${probePayload.byteLength}B)`)
  } catch (e) {
    fail('Cloud.ru PUT', e)
  }

  try {
    const head = await cloudru.head(probeKey)
    if (!head.exists) throw new Error('HEAD после PUT вернул 404 — что-то с конфигурацией')
    if (head.size !== probePayload.byteLength) {
      throw new Error(`размер не совпадает: ожидали ${probePayload.byteLength}, получили ${head.size}`)
    }
    ok(`Cloud.ru HEAD прошёл (size=${head.size}, etag=${head.etag || '-'})`)
  } catch (e) {
    fail('Cloud.ru HEAD', e)
  }

  try {
    const got = await cloudru.get(probeKey)
    const sameLen = got.size === probePayload.byteLength
    const sameBytes = sameLen && Buffer.from(got.body).equals(Buffer.from(probePayload))
    if (!sameBytes) throw new Error('содержимое probe-объекта не совпало с залитым')
    ok(`Cloud.ru GET вернул ровно те же байты`)
  } catch (e) {
    fail('Cloud.ru GET', e)
  }

  try {
    await cloudru.delete(probeKey)
    ok('Cloud.ru DELETE убрал probe-объект')
  } catch (e) {
    fail('Cloud.ru DELETE', e)
  }

  // 4. R2 — HEAD на одной случайной r2-строке (если такие есть)
  if (photosR2 > 0) {
    try {
      let probedKey = null
      for await (const batch of iterPhotosToMigrate(supabase, 1)) {
        if (batch.length > 0) {
          probedKey = batch[0].r2_key
          break
        }
      }
      if (!probedKey) throw new Error('не нашли ни одной строки storage=r2')
      const head = await r2.head(probedKey)
      if (!head.exists) {
        throw new Error(
          `объект ${probedKey} помечен в БД как r2, но в R2 его нет. Это блокер миграции.`,
        )
      }
      ok(`R2 HEAD на пробной фотографии: size=${head.size}B`)
    } catch (e) {
      fail('R2 HEAD', e)
      hintR2Failure(env)
    }
  } else if (plansR2 > 0) {
    try {
      let probedKey = null
      for await (const batch of iterPlansToMigrate(supabase, 1)) {
        if (batch.length > 0) {
          probedKey = batch[0].r2_key
          break
        }
      }
      if (!probedKey) throw new Error('не нашли ни одной строки storage=r2')
      const head = await r2.head(probedKey)
      if (!head.exists) {
        throw new Error(
          `план ${probedKey} помечен в БД как r2, но в R2 его нет. Это блокер миграции.`,
        )
      }
      ok(`R2 HEAD на пробном плане: size=${head.size}B`)
    } catch (e) {
      fail('R2 HEAD', e)
      hintR2Failure(env)
    }
  } else {
    log.bullet('R2 HEAD: пропущено (storage=r2 строк нет — переносить нечего)')
  }

  // 5. Сводка
  log.header('Что предстоит перенести')
  const photoObjects = photosR2 * 2 // full + thumb
  const planObjects = plansR2
  log.raw(`  Фото (rows):           ${photosR2}`)
  log.raw(`  Фото-объектов в R2:    ${photoObjects} (full + thumb)`)
  log.raw(`  Планов (rows):         ${plansR2}`)
  log.raw(`  План-объектов в R2:    ${planObjects}`)
  log.raw(`  ИТОГО объектов:        ${photoObjects + planObjects}`)
  log.raw('')
  log.raw(`  Уже на Cloud.ru — фото: ${photosCloudru}, планы: ${plansCloudru}`)

  summary(okSteps, failSteps)
  return failSteps === 0 ? 0 : 1
}

function summary(okSteps, failSteps) {
  log.header('Итого')
  log.raw(`  Проверок прошло: ${okSteps}`)
  log.raw(`  Проверок упало:  ${failSteps}`)
  log.raw('')
  if (failSteps === 0) {
    log.success('Preflight OK. Можно запускать `npm run migrate:storage:run`.')
  } else {
    log.error('Preflight НЕ ПРОЙДЕН. Исправьте ошибки выше и повторите check.')
  }
}

/**
 * Печатает пошаговую подсказку при сбое R2 HEAD. Большинство ошибок
 * сводится к одной из трёх причин — даём пользователю чек-лист, чтобы
 * не гадать.
 */
function hintR2Failure(env) {
  const accountIdMatch = env.r2.endpoint.match(/^https?:\/\/([^.]+)\./)
  const accountId = accountIdMatch?.[1] ?? '(?)'
  log.bullet('Возможные причины сбоя R2 HEAD:')
  log.raw(`    1. Опечатка в R2_ACCOUNT_ID. Сейчас в endpoint: "${accountId}"`)
  log.raw(`       (длина ${accountId.length} символов; Cloudflare Account ID — ровно 32 hex)`)
  log.raw('       → Cloudflare Dashboard → R2 → правая панель «Account ID».')
  log.raw('    2. Неверный R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.')
  log.raw('       → Создайте новый S3-Compatible (НЕ admin) токен в Cloudflare.')
  log.raw('    3. Корпоративный прокси / VPN режет r2.cloudflarestorage.com.')
  log.raw('       → Проверьте: nslookup ' + (accountIdMatch ? `${accountId}.r2.cloudflarestorage.com` : '<account>.r2.cloudflarestorage.com'))
  log.raw('       → При необходимости задайте свой R2_ENDPOINT в .env.migrate.')
}
