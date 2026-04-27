import { supabase } from '@/lib/supabase'
import type { AdminProfile, Role } from '@/entities/profile/types'
import type { Project, ProjectInput } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer, PerformerKind } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('Пустой ответ от Supabase')
  return data
}

// ---------- Profiles ----------
export async function listProfiles(): Promise<AdminProfile[]> {
  const { data, error } = await supabase.rpc('admin_list_profiles')
  return unwrap(data as AdminProfile[] | null, error)
}

export async function updateProfileFullName(id: string, full_name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ full_name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setProfileActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ is_active }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setProfileRole(id: string, role: Role): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- Projects ----------
export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('name', { ascending: true })
    .limit(500)
  return unwrap(data as Project[] | null, error)
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name: input.name, description: input.description ?? null })
    .select('*')
    .single()
  return unwrap(data as Project | null, error)
}

export async function updateProject(id: string, input: ProjectInput): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ name: input.name, description: input.description ?? null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- Project memberships ----------
export async function listProjectMemberships(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('project_memberships')
    .select('project_id')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.project_id as string)
}

export async function setUserProjects(userId: string, projectIds: string[]): Promise<void> {
  const current = await listProjectMemberships(userId)
  const currentSet = new Set(current)
  const nextSet = new Set(projectIds)
  const toAdd = projectIds.filter((id) => !currentSet.has(id))
  const toRemove = current.filter((id) => !nextSet.has(id))

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('project_memberships')
      .insert(toAdd.map((project_id) => ({ project_id, user_id: userId })))
    if (error) throw new Error(error.message)
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('project_memberships')
      .delete()
      .eq('user_id', userId)
      .in('project_id', toRemove)
    if (error) throw new Error(error.message)
  }
}

// ---------- Work types ----------
export async function listWorkTypes(): Promise<WorkType[]> {
  const { data, error } = await supabase
    .from('work_types')
    .select('*')
    .order('name', { ascending: true })
    .limit(500)
  return unwrap(data as WorkType[] | null, error)
}

export async function createWorkType(name: string): Promise<WorkType> {
  const { data, error } = await supabase
    .from('work_types')
    .insert({ name, is_active: true })
    .select('*')
    .single()
  return unwrap(data as WorkType | null, error)
}

export async function updateWorkType(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('work_types').update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setWorkTypeActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('work_types').update({ is_active }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- Work assignments ----------
export async function listWorkAssignments(): Promise<WorkAssignment[]> {
  const { data, error } = await supabase
    .from('work_assignments')
    .select('*')
    .order('name', { ascending: true })
    .limit(500)
  return unwrap(data as WorkAssignment[] | null, error)
}

export async function createWorkAssignment(name: string): Promise<WorkAssignment> {
  const { data, error } = await supabase
    .from('work_assignments')
    .insert({ name, is_active: true })
    .select('*')
    .single()
  return unwrap(data as WorkAssignment | null, error)
}

export async function updateWorkAssignment(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('work_assignments').update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setWorkAssignmentActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('work_assignments').update({ is_active }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ---------- Performers ----------
export async function listPerformers(): Promise<Performer[]> {
  const { data, error } = await supabase
    .from('performers')
    .select('*')
    .order('name', { ascending: true })
    .limit(500)
  return unwrap(data as Performer[] | null, error)
}

export async function createPerformer(input: { name: string; kind: PerformerKind }): Promise<Performer> {
  const { data, error } = await supabase
    .from('performers')
    .insert({ name: input.name, kind: input.kind, is_active: true })
    .select('*')
    .single()
  return unwrap(data as Performer | null, error)
}

export async function updatePerformer(
  id: string,
  input: { name: string; kind: PerformerKind },
): Promise<void> {
  const { error } = await supabase
    .from('performers')
    .update({ name: input.name, kind: input.kind })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setPerformerActive(id: string, is_active: boolean): Promise<void> {
  const { error } = await supabase.from('performers').update({ is_active }).eq('id', id)
  if (error) throw new Error(error.message)
}
