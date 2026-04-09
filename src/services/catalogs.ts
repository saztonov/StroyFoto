import { supabase } from '@/lib/supabase'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import { getDB, type CatalogKey } from '@/lib/db'

export interface PlanRow {
  id: string
  project_id: string
  name: string
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

export async function createWorkType(name: string): Promise<WorkType> {
  const { data, error } = await supabase
    .from('work_types')
    .insert({ name })
    .select('id,name,is_active,created_by,created_at')
    .single()
  if (error) {
    // Если уже есть с таким именем — подтянем существующий.
    if (/duplicate|unique/i.test(error.message)) {
      const { data: existing, error: e2 } = await supabase
        .from('work_types')
        .select('id,name,is_active,created_by,created_at')
        .eq('name', name)
        .single()
      if (e2) throw e2
      return existing as WorkType
    }
    throw error
  }
  return data as WorkType
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
    .select('id,project_id,name,r2_key,page_count,created_at')
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
