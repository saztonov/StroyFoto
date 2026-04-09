import { supabase } from '@/lib/supabase'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'

export interface PlanRow {
  id: string
  project_id: string
  name: string
  r2_key: string
  page_count: number | null
  created_at: string
}

const CACHE_PREFIX = 'stroyfoto:cache:'

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data))
  } catch {
    // ignore quota
  }
}

export async function loadProjectsForUser(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,description,created_by,created_at,updated_at')
    .order('name', { ascending: true })
  if (error) {
    const cached = readCache<Project[]>('projects')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as Project[]
  writeCache('projects', list)
  return list
}

export async function loadWorkTypes(): Promise<WorkType[]> {
  const { data, error } = await supabase
    .from('work_types')
    .select('id,name,is_active,created_by,created_at')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) {
    const cached = readCache<WorkType[]>('work_types')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as WorkType[]
  writeCache('work_types', list)
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
    const cached = readCache<Performer[]>('performers')
    if (cached) return cached
    throw error
  }
  const list = (data ?? []) as Performer[]
  writeCache('performers', list)
  return list
}

export async function loadPlansForProject(projectId: string): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('id,project_id,name,r2_key,page_count,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PlanRow[]
}
