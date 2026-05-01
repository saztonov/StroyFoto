// Тонкая обёртка над Supabase service-role client'ом для CLI миграции.
//
// Service role обходит RLS — это сознательно: миграция должна видеть и
// изменять любые строки. Никогда не используйте этот клиент в браузере.
//
// Все операции батчевые и пагинированные, чтобы корректно работать с
// большими таблицами (100k+ rows).

import { createClient } from '@supabase/supabase-js'

const PAGE_SIZE = 500

/**
 * @param {{ url: string, serviceRoleKey: string }} cfg
 */
export function createServiceClient(cfg) {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      // Без user-agent некоторые корпоративные прокси режут запрос.
      headers: { 'x-stroyfoto-tool': 'migrate-storage' },
    },
  })
}

/** Считает строки в указанной таблице с заданным storage. */
export async function countByStorage(supabase, table, storage) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('storage', storage)
  if (error) throw new Error(`count ${table}/${storage}: ${error.message}`)
  return count ?? 0
}

/**
 * Проверяет, что в таблице есть колонка `storage`. Если нет — миграция
 * SQL ещё не применена. Возвращает true/false.
 */
export async function hasStorageColumn(supabase, table) {
  // Пробуем выбрать одну строку с колонкой storage; если колонки нет,
  // PostgREST вернёт ошибку с кодом 42703 (undefined column).
  const { error } = await supabase.from(table).select('storage').limit(1)
  if (!error) return true
  const msg = error.message ?? ''
  if (/storage/i.test(msg) && /(does not exist|column)/i.test(msg)) return false
  // Любая другая ошибка — считаем что что-то не так с подключением и
  // пробрасываем выше.
  throw new Error(`hasStorageColumn ${table}: ${msg}`)
}

/**
 * Постранично читает строки `report_photos` со storage='r2'.
 *
 * ВАЖНО: используем keyset-пагинацию (cursor by `id`), а НЕ offset/limit
 * через `.range()`. Причина: миграция МУТИРУЕТ источник — после успешной
 * обработки строки её `storage` становится `'cloudru'`, и она выпадает из
 * фильтра `eq('storage','r2')`. С offset-пагинацией это съедает хвост
 * выборки: вторая страница `range(500, 999)` начинает считать от новой
 * позиции 500 в уже сжавшейся выборке. Cursor `gt('id', lastId)` гонит
 * курсор только вперёд по id и не зависит от того, кто исчез из фильтра.
 *
 * Побочный эффект: если строка УПАЛА (storage остался 'r2'), мы её НЕ
 * перечитаем в том же run — нужен повторный `run`. Это намеренно: иначе
 * упорно падающая строка зациклит миграцию.
 */
export async function* iterPhotosToMigrate(supabase, batchSize = PAGE_SIZE) {
  let lastId = null
  while (true) {
    let q = supabase
      .from('report_photos')
      .select('id, report_id, r2_key, thumb_r2_key, storage')
      .eq('storage', 'r2')
      .order('id', { ascending: true })
      .limit(batchSize)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`fetch report_photos: ${error.message}`)
    if (!data || data.length === 0) return
    yield data
    lastId = data[data.length - 1].id
    if (data.length < batchSize) return
  }
}

/** То же по той же причине — keyset-пагинация. */
export async function* iterPlansToMigrate(supabase, batchSize = PAGE_SIZE) {
  let lastId = null
  while (true) {
    let q = supabase
      .from('plans')
      .select('id, project_id, r2_key, storage')
      .eq('storage', 'r2')
      .order('id', { ascending: true })
      .limit(batchSize)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`fetch plans: ${error.message}`)
    if (!data || data.length === 0) return
    yield data
    lastId = data[data.length - 1].id
    if (data.length < batchSize) return
  }
}

/**
 * То же, но для verify (читает строки уже на нужном storage).
 * Используем keyset для консистентности и устойчивости к параллельным
 * мутациям (например, если кто-то запустил `run` параллельно с verify).
 */
export async function* iterPhotosOn(supabase, storage, batchSize = PAGE_SIZE) {
  let lastId = null
  while (true) {
    let q = supabase
      .from('report_photos')
      .select('id, report_id, r2_key, thumb_r2_key, storage')
      .eq('storage', storage)
      .order('id', { ascending: true })
      .limit(batchSize)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`fetch report_photos: ${error.message}`)
    if (!data || data.length === 0) return
    yield data
    lastId = data[data.length - 1].id
    if (data.length < batchSize) return
  }
}

export async function* iterPlansOn(supabase, storage, batchSize = PAGE_SIZE) {
  let lastId = null
  while (true) {
    let q = supabase
      .from('plans')
      .select('id, project_id, r2_key, storage')
      .eq('storage', storage)
      .order('id', { ascending: true })
      .limit(batchSize)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`fetch plans: ${error.message}`)
    if (!data || data.length === 0) return
    yield data
    lastId = data[data.length - 1].id
    if (data.length < batchSize) return
  }
}

/**
 * Помечает report_photos.storage='cloudru' с защитой от гонки: меняет
 * только если строка ВСЁ ЕЩЁ помечена 'r2'. Возвращает число обновлений
 * (1 — обычный успех, 0 — кто-то изменил раньше → не считаем ошибкой).
 */
export async function markPhotoMigrated(supabase, id) {
  const { data, error } = await supabase
    .from('report_photos')
    .update({ storage: 'cloudru' })
    .eq('id', id)
    .eq('storage', 'r2')
    .select('id')
  if (error) throw new Error(`update report_photos ${id}: ${error.message}`)
  return data?.length ?? 0
}

export async function markPlanMigrated(supabase, id) {
  const { data, error } = await supabase
    .from('plans')
    .update({ storage: 'cloudru' })
    .eq('id', id)
    .eq('storage', 'r2')
    .select('id')
  if (error) throw new Error(`update plans ${id}: ${error.message}`)
  return data?.length ?? 0
}
