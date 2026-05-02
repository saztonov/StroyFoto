import { v4 as uuid } from 'uuid'
import { apiFetch } from '@/lib/apiClient'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import {
  getDB,
  type CatalogKey,
  type LocalWorkAssignment,
  type LocalWorkType,
  type SyncOp,
} from '@/lib/db'

export interface PlanRow {
  id: string
  project_id: string
  name: string
  floor: string | null
  building: string | null
  section: string | null
  object_key: string
  page_count: number | null
  created_at: string
}

/** Кэш справочников считается свежим в течение 10 минут. */
const CATALOG_TTL_MS = 10 * 60 * 1000

const LEGACY_CACHE_PREFIX = 'stroyfoto:cache:'
let legacyMigrated = false

// Кэш справочников теперь живёт в IndexedDB (store `catalogs`), а не в
// localStorage — это даёт офлайн-доступ без размерных ограничений и единую
// точку истины. Сигнатуры readCache/writeCache сохранены для совместимости
// с вызовами ниже; они асинхронные.

interface CacheResult<T> {
  data: T | null
  stale: boolean
}

async function readCache<T>(key: CatalogKey): Promise<CacheResult<T>> {
  try {
    await migrateLegacyCacheOnce()
    const db = await getDB()
    const rec = await db.get('catalogs', key)
    if (!rec) return { data: null, stale: true }
    const stale = (Date.now() - rec.updatedAt) > CATALOG_TTL_MS
    return { data: (rec.payload as T) ?? null, stale }
  } catch {
    return { data: null, stale: true }
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
  const keys: CatalogKey[] = ['projects', 'work_types', 'performers', 'work_assignments', 'plans']
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

export async function loadProjectsForUser(forceRefresh = false): Promise<Project[]> {
  const cache = await readCache<Project[]>('projects')
  if (!forceRefresh && !cache.stale && cache.data) return cache.data

  try {
    const data = await apiFetch<{ projects: Project[] }>('/api/projects')
    const list = data.projects
    await writeCache('projects', list)
    return list
  } catch (e) {
    if (cache.data) return cache.data
    throw e
  }
}

export async function loadWorkTypes(forceRefresh = false): Promise<WorkType[]> {
  const cache = await readCache<WorkType[]>('work_types')
  if (!forceRefresh && !cache.stale && cache.data) return cache.data

  try {
    const data = await apiFetch<{ workTypes: WorkType[] }>(
      '/api/work-types?active=true',
    )
    const list = data.workTypes
    await writeCache('work_types', list)
    return list
  } catch (e) {
    if (cache.data) return cache.data
    throw e
  }
}

/**
 * Создаёт или «ставит в очередь» новый вид работ единым путём:
 *  1) Если уже есть запись с таким именем (в кэше catalogs или локально) —
 *     возвращаем её без дублей.
 *  2) Иначе генерируем client UUID, пишем draft в `work_types_local`,
 *     ставим задачу в sync_queue (kind='work_type'). Sync loop отправляет
 *     `POST /api/work-types` (idempotent upsert по id или citext-уникальному
 *     name) — с тем же UUID, так что на всех устройствах id сойдётся после
 *     очередного loadWorkTypes.
 *  3) Опционально возвращаем свежий объект, который UI подставляет в список.
 *
 * Работает одинаково в online и offline — это сознательный выбор: никакой
 * «тихой разницы» в поведении, пользователь всегда видит одно и то же.
 */
export async function createOrQueueWorkType(name: string): Promise<WorkType> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Пустое название')

  // 1) Проверка на дубликат в уже загруженных серверных значениях.
  const cachedResult = await readCache<WorkType[]>('work_types')
  const cachedList = cachedResult.data ?? []
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

export async function loadWorkAssignments(forceRefresh = false): Promise<WorkAssignment[]> {
  const cache = await readCache<WorkAssignment[]>('work_assignments')
  if (!forceRefresh && !cache.stale && cache.data) return cache.data

  try {
    const data = await apiFetch<{ workAssignments: WorkAssignment[] }>(
      '/api/work-assignments?active=true',
    )
    const list = data.workAssignments
    await writeCache('work_assignments', list)
    return list
  } catch (e) {
    if (cache.data) return cache.data
    throw e
  }
}

/**
 * Создаёт или ставит в очередь новое назначение работ. Полная аналогия
 * `createOrQueueWorkType`: онлайн — задача уйдёт через sync-очередь сразу,
 * офлайн — оставит draft в IDB и upsert на возврат сети.
 */
export async function createOrQueueWorkAssignment(name: string): Promise<WorkAssignment> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Пустое название')

  const cachedResult = await readCache<WorkAssignment[]>('work_assignments')
  const cachedList = cachedResult.data ?? []
  const existingServer = cachedList.find((w) => w.name.toLowerCase() === trimmed.toLowerCase())
  if (existingServer) return existingServer

  const db = await getDB()
  const locals = await db.getAll('work_assignments_local')
  const existingLocal = locals.find((w) => w.name.toLowerCase() === trimmed.toLowerCase())
  if (existingLocal) {
    return {
      id: existingLocal.id,
      name: existingLocal.name,
      is_active: true,
      created_by: null,
      created_at: existingLocal.createdAt,
    } as WorkAssignment
  }

  const id = uuid()
  const createdAt = new Date().toISOString()
  const draft: LocalWorkAssignment = {
    id,
    name: trimmed,
    createdAt,
    syncStatus: 'pending',
  }

  const tx = db.transaction(['work_assignments_local', 'sync_queue'], 'readwrite')
  await tx.objectStore('work_assignments_local').put(draft)
  const op: SyncOp = {
    kind: 'work_assignment',
    entityId: id,
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
  }
  await tx.objectStore('sync_queue').add(op)
  await tx.done

  const updatedCache = [
    ...cachedList,
    { id, name: trimmed, is_active: true, created_by: null, created_at: createdAt } as WorkAssignment,
  ]
  await writeCache('work_assignments', updatedCache)

  return {
    id,
    name: trimmed,
    is_active: true,
    created_by: null,
    created_at: createdAt,
  } as WorkAssignment
}

export async function loadPerformers(forceRefresh = false): Promise<Performer[]> {
  const cache = await readCache<Performer[]>('performers')
  if (!forceRefresh && !cache.stale && cache.data) return cache.data

  try {
    const data = await apiFetch<{ performers: Performer[] }>(
      '/api/performers?active=true',
    )
    const list = data.performers
    await writeCache('performers', list)
    return list
  } catch (e) {
    if (cache.data) return cache.data
    throw e
  }
}

interface ServerPlanRow extends PlanRow {
  uploaded_by: string | null
  updated_at: string
}

export async function loadPlansForProject(projectId: string): Promise<PlanRow[]> {
  try {
    const data = await apiFetch<{ plans: ServerPlanRow[] }>(
      `/api/projects/${projectId}/plans`,
    )
    const list: PlanRow[] = data.plans.map((p) => ({
      id: p.id,
      project_id: p.project_id,
      name: p.name,
      floor: p.floor,
      building: p.building,
      section: p.section,
      object_key: p.object_key,
      page_count: p.page_count,
      created_at: p.created_at,
    }))
    const cache = await readCache<Record<string, PlanRow[]>>('plans')
    const existing = cache.data ?? {}
    existing[projectId] = list
    await writeCache('plans', existing)
    return list
  } catch (e) {
    const cache = await readCache<Record<string, PlanRow[]>>('plans')
    if (cache.data?.[projectId]) return cache.data[projectId]
    throw e
  }
}
