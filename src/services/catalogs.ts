import { v4 as uuid } from 'uuid'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import { getDB, type CatalogKey, type LocalWorkType, type SyncOp } from '@/lib/db'

export interface PlanRow {
  id: string
  project_id: string
  name: string
  floor: string | null
  building: string | null
  section: string | null
  r2_key: string
  page_count: number | null
  created_at: string
}

const LEGACY_CACHE_PREFIX = 'stroyfoto:cache:'
let legacyMigrated = false

// Кэш справочников теперь живёт в IndexedDB (store `catalogs`), а не в
// localStorage — это даёт офлайн-доступ без размерных ограничений и единую
// точку истины. Сигнатуры readCache/writeCache сохранены для совместимости
// с вызовами ниже; они асинхронные.

async function readCache<T>(key: CatalogKey): Promise<T | null> {
  try {
    await migrateLegacyCacheOnce()
    const db = await getDB()
    const rec = await db.get('catalogs', key)
    return (rec?.payload as T) ?? null
  } catch {
    return null
  }
}

async function writeCache<T>(key: CatalogKey, data: T): Promise<void> {
  try {
    const db = await getDB()
    await db.put('catalogs', { key, payload: data, updatedAt: Date.now() })
  } catch {
    // ignore quota
  }
}

async function migrateLegacyCacheOnce(): Promise<void> {
  if (legacyMigrated) return
  legacyMigrated = true
  if (typeof localStorage === 'undefined') return
  const keys: CatalogKey[] = ['projects', 'work_types', 'performers', 'plans']
  try {
    const db = await getDB()
    for (const key of keys) {
      const raw = localStorage.getItem(LEGACY_CACHE_PREFIX + key)
      if (!raw) continue
      try {
        const payload = JSON.parse(raw)
        const existing = await db.get('catalogs', key)
        if (!existing) {
          await db.put('catalogs', { key, payload, updatedAt: Date.now() })
        }
      } catch {
        // ignore
      }
      localStorage.removeItem(LEGACY_CACHE_PREFIX + key)
    }
  } catch {
    // ignore
  }
}

export async function loadProjectsForUser(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,description,created_by,created_at,updated_at')
    .order('name', { ascending: true })
  if (error) {
    const cached = await readCache<Project[]>('projects')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as Project[]
  await writeCache('projects', list)
  return list
}

export async function loadWorkTypes(): Promise<WorkType[]> {
  const { data, error } = await supabase
    .from('work_types')
    .select('id,name,is_active,created_by,created_at')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) {
    const cached = await readCache<WorkType[]>('work_types')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as WorkType[]
  await writeCache('work_types', list)
  return list
}

/**
 * Создаёт или «ставит в очередь» новый вид работ единым путём:
 *  1) Если уже есть запись с таким именем (в кэше catalogs или локально) —
 *     возвращаем её без дублей.
 *  2) Иначе генерируем client UUID, пишем draft в `work_types_local`,
 *     ставим задачу в sync_queue (kind='work_type'). Sync loop делает
 *     `supabase.from('work_types').upsert({ id, name })` — с тем же UUID,
 *     так что на всех устройствах id сойдётся после очередного loadWorkTypes.
 *  3) Опционально возвращаем свежий объект, который UI подставляет в список.
 *
 * Работает одинаково в online и offline — это сознательный выбор: никакой
 * «тихой разницы» в поведении, пользователь всегда видит одно и то же.
 */
export async function createOrQueueWorkType(name: string): Promise<WorkType> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Пустое название')

  // 1) Проверка на дубликат в уже загруженных серверных значениях.
  const cachedList = (await readCache<WorkType[]>('work_types')) ?? []
  const existingServer = cachedList.find((w) => w.name.toLowerCase() === trimmed.toLowerCase())
  if (existingServer) return existingServer

  // 2) Проверка на дубликат среди локальных (ещё не засинканных) записей.
  const db = await getDB()
  const locals = await db.getAll('work_types_local')
  const existingLocal = locals.find((w) => w.name.toLowerCase() === trimmed.toLowerCase())
  if (existingLocal) {
    return {
      id: existingLocal.id,
      name: existingLocal.name,
      is_active: true,
      created_by: null,
      created_at: existingLocal.createdAt,
    } as WorkType
  }

  // 3) Новый черновик: client UUID → IDB → sync_queue.
  const id = uuid()
  const createdAt = new Date().toISOString()
  const draft: LocalWorkType = {
    id,
    name: trimmed,
    createdAt,
    syncStatus: 'pending',
  }

  const tx = db.transaction(['work_types_local', 'sync_queue'], 'readwrite')
  await tx.objectStore('work_types_local').put(draft)
  const op: SyncOp = {
    kind: 'work_type',
    entityId: id,
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
  }
  await tx.objectStore('sync_queue').add(op)
  await tx.done

  // Добавляем в catalog-кэш, чтобы сразу появился в выпадашке на всех вызовах.
  const updatedCache = [
    ...cachedList,
    { id, name: trimmed, is_active: true, created_by: null, created_at: createdAt } as WorkType,
  ]
  await writeCache('work_types', updatedCache)

  return {
    id,
    name: trimmed,
    is_active: true,
    created_by: null,
    created_at: createdAt,
  } as WorkType
}

export async function loadPerformers(): Promise<Performer[]> {
  const { data, error } = await supabase
    .from('performers')
    .select('id,name,kind,is_active,created_at')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) {
    const cached = await readCache<Performer[]>('performers')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as Performer[]
  await writeCache('performers', list)
  return list
}

export async function loadPlansForProject(projectId: string): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('id,project_id,name,floor,r2_key,page_count,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    const cached = await readCache<Record<string, PlanRow[]>>('plans')
    if (cached?.[projectId]) return cached[projectId]
    throw error
  }
  const list = (data ?? []) as PlanRow[]
  const cached = (await readCache<Record<string, PlanRow[]>>('plans')) ?? {}
  cached[projectId] = list
  await writeCache('plans', cached)
  return list
}
