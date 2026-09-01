import { apiFetch } from '@/lib/apiClient'
import type { AdminProfile, Role } from '@/entities/profile/types'
import type { Project, ProjectInput } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer, PerformerKind } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import type { PasswordResetRequest } from '@/entities/passwordReset/types'

// ---------- Profiles ----------
export async function listProfiles(): Promise<AdminProfile[]> {
  const data = await apiFetch<{ profiles: AdminProfile[] }>(
    '/api/admin/profiles',
  )
  return data.profiles
}

export async function updateProfileFullName(
  id: string,
  full_name: string,
): Promise<void> {
  await apiFetch(`/api/admin/profiles/${id}/full-name`, {
    method: 'PATCH',
    body: { full_name },
  })
}

export async function setProfileActive(
  id: string,
  is_active: boolean,
): Promise<void> {
  await apiFetch(`/api/admin/profiles/${id}/active`, {
    method: 'PATCH',
    body: { is_active },
  })
}

export async function setProfileRole(id: string, role: Role): Promise<void> {
  await apiFetch(`/api/admin/profiles/${id}/role`, {
    method: 'PATCH',
    body: { role },
  })
}

// ---------- Сброс паролей ----------
export async function listPasswordResets(): Promise<PasswordResetRequest[]> {
  const data = await apiFetch<{ requests: PasswordResetRequest[] }>(
    '/api/admin/password-resets',
  )
  return data.requests
}

/**
 * Выдаёт одноразовую ссылку. Сырой токен приходит РОВНО ОДИН РАЗ — на сервере
 * хранится только его хэш, показать повторно нечего.
 *
 * Ссылку собираем здесь, а не на сервере: у бэкенда нет надёжного публичного
 * origin (CORS_ORIGINS — список), а отдельная env-переменная стала бы ещё
 * одним способом ошибиться при деплое. Токен уходит во fragment: браузер не
 * отправляет его ни на сервер, ни в Referer, поэтому в access-логе nginx
 * останется только путь.
 */
export async function issuePasswordResetLink(
  userId: string,
): Promise<{ request: PasswordResetRequest; url: string }> {
  const data = await apiFetch<{ request: PasswordResetRequest; token: string }>(
    '/api/admin/password-resets',
    { method: 'POST', body: { user_id: userId } },
  )
  return {
    request: data.request,
    url: `${window.location.origin}/reset-password#token=${data.token}`,
  }
}

export async function cancelPasswordReset(id: string): Promise<void> {
  await apiFetch(`/api/admin/password-resets/${id}/cancel`, { method: 'POST' })
}

// ---------- Projects ----------
export async function listProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/api/admin/projects')
  return data.projects
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const data = await apiFetch<{ project: Project }>('/api/admin/projects', {
    method: 'POST',
    body: { name: input.name, description: input.description ?? null },
  })
  return data.project
}

export async function updateProject(
  id: string,
  input: ProjectInput,
): Promise<void> {
  await apiFetch(`/api/admin/projects/${id}`, {
    method: 'PATCH',
    body: { name: input.name, description: input.description ?? null },
  })
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/api/admin/projects/${id}`, { method: 'DELETE' })
}

// ---------- Project memberships ----------
export async function listProjectMemberships(
  userId: string,
): Promise<string[]> {
  const data = await apiFetch<{ projectIds: string[] }>(
    `/api/admin/profiles/${userId}/projects`,
  )
  return data.projectIds
}

export async function setUserProjects(
  userId: string,
  projectIds: string[],
): Promise<void> {
  await apiFetch(`/api/admin/profiles/${userId}/projects`, {
    method: 'PUT',
    body: { projectIds },
  })
}

// ---------- Work types ----------
export async function listWorkTypes(): Promise<WorkType[]> {
  const data = await apiFetch<{ workTypes: WorkType[] }>(
    '/api/admin/work-types',
  )
  return data.workTypes
}

export async function createWorkType(name: string): Promise<WorkType> {
  const data = await apiFetch<{ workType: WorkType }>(
    '/api/admin/work-types',
    { method: 'POST', body: { name } },
  )
  return data.workType
}

export async function updateWorkType(id: string, name: string): Promise<void> {
  await apiFetch(`/api/admin/work-types/${id}`, {
    method: 'PATCH',
    body: { name },
  })
}

export async function setWorkTypeActive(
  id: string,
  is_active: boolean,
): Promise<void> {
  await apiFetch(`/api/admin/work-types/${id}/active`, {
    method: 'PATCH',
    body: { is_active },
  })
}

/** Вернёт ошибку DICT_IN_USE, если вид работ использован хотя бы в одном отчёте. */
export async function deleteWorkType(id: string): Promise<void> {
  await apiFetch(`/api/admin/work-types/${id}`, { method: 'DELETE' })
}

// ---------- Work assignments ----------
export async function listWorkAssignments(): Promise<WorkAssignment[]> {
  const data = await apiFetch<{ workAssignments: WorkAssignment[] }>(
    '/api/admin/work-assignments',
  )
  return data.workAssignments
}

export async function createWorkAssignment(
  name: string,
): Promise<WorkAssignment> {
  const data = await apiFetch<{ workAssignment: WorkAssignment }>(
    '/api/admin/work-assignments',
    { method: 'POST', body: { name } },
  )
  return data.workAssignment
}

export async function updateWorkAssignment(
  id: string,
  name: string,
): Promise<void> {
  await apiFetch(`/api/admin/work-assignments/${id}`, {
    method: 'PATCH',
    body: { name },
  })
}

/** Вернёт ошибку DICT_IN_USE, если назначение использовано хотя бы в одном отчёте. */
export async function deleteWorkAssignment(id: string): Promise<void> {
  await apiFetch(`/api/admin/work-assignments/${id}`, { method: 'DELETE' })
}

export async function setWorkAssignmentActive(
  id: string,
  is_active: boolean,
): Promise<void> {
  await apiFetch(`/api/admin/work-assignments/${id}/active`, {
    method: 'PATCH',
    body: { is_active },
  })
}

// ---------- Performers ----------
export async function listPerformers(): Promise<Performer[]> {
  const data = await apiFetch<{ performers: Performer[] }>(
    '/api/admin/performers',
  )
  return data.performers
}

export async function createPerformer(input: {
  name: string
  kind: PerformerKind
}): Promise<Performer> {
  const data = await apiFetch<{ performer: Performer }>(
    '/api/admin/performers',
    { method: 'POST', body: { name: input.name, kind: input.kind } },
  )
  return data.performer
}

export async function updatePerformer(
  id: string,
  input: { name: string; kind: PerformerKind },
): Promise<void> {
  await apiFetch(`/api/admin/performers/${id}`, {
    method: 'PATCH',
    body: { name: input.name, kind: input.kind },
  })
}

export async function setPerformerActive(
  id: string,
  is_active: boolean,
): Promise<void> {
  await apiFetch(`/api/admin/performers/${id}/active`, {
    method: 'PATCH',
    body: { is_active },
  })
}
