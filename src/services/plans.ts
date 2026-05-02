import { v4 as uuidv4 } from 'uuid'
import { apiFetch } from '@/lib/apiClient'
import { getDB } from '@/lib/db'
import {
  getFromPresigned,
  planKey,
  putToPresigned,
  requestPresigned,
  type StorageProvider,
} from '@/services/r2'
import type { PlanRow } from '@/services/catalogs'

export interface PlanRecord {
  id: string
  project_id: string
  name: string
  floor: string | null
  building: string | null
  section: string | null
  r2_key: string
  /**
   * Где лежит PDF-файл: `cloudru` (текущий активный провайдер) или `r2`
   * (исторические объекты, до миграции). Поле необязательно для совместимости:
   * если отсутствует — считаем 'cloudru'.
   */
  storage?: StorageProvider
  page_count: number | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export function planDisplayName(plan: Pick<PlanRecord, 'name' | 'floor' | 'building' | 'section'>): string {
  const parts: string[] = []
  if (plan.building) parts.push(plan.building)
  if (plan.section) parts.push(plan.section)
  if (plan.floor) parts.push(`Этаж ${plan.floor}`)
  return parts.length > 0 ? `${parts.join(', ')} — ${plan.name}` : plan.name
}

/**
 * Преобразует «плоскую» строку из таблицы plans (PlanRow из каталогов) в
 * полноценный PlanRecord, ожидаемый сервисами загрузки/удаления PDF.
 * uploaded_by/updated_at в PlanRow не хранятся — поля заполняются разумными дефолтами.
 */
export function planRowToRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    floor: row.floor ?? null,
    building: row.building ?? null,
    section: row.section ?? null,
    r2_key: row.r2_key,
    storage: row.storage ?? 'cloudru',
    page_count: row.page_count,
    uploaded_by: null,
    created_at: row.created_at,
    updated_at: row.created_at,
  }
}

/**
 * Загружает PDF-план в приватный бакет Cloud.ru S3 и регистрирует его
 * через backend POST /api/plans. Все новые планы записываются с `storage='cloudru'`.
 */
export async function uploadPlanPdf(
  file: File,
  projectId: string,
  name: string,
  floor: string | null,
  building: string | null,
  section: string | null,
  pageCount: number | null,
): Promise<PlanRecord> {
  const planId = uuidv4()
  const key = planKey(projectId, planId)

  const presigned = await requestPresigned({
    op: 'put',
    kind: 'plan',
    key,
    projectId,
    planId,
    contentType: 'application/pdf',
  })
  await putToPresigned(presigned, file)

  const data = await apiFetch<{ plan: PlanRecord }>('/api/plans', {
    method: 'POST',
    body: {
      id: planId,
      project_id: projectId,
      name,
      floor,
      building,
      section,
      r2_key: key,
      page_count: pageCount,
    },
  })
  return data.plan
}

export async function listPlansForProject(projectId: string): Promise<PlanRecord[]> {
  const data = await apiFetch<{ plans: PlanRecord[] }>(
    `/api/projects/${projectId}/plans`,
  )
  return data.plans
}

export async function listAllVisiblePlans(): Promise<PlanRecord[]> {
  const data = await apiFetch<{ plans: PlanRecord[] }>('/api/plans')
  return data.plans
}

/**
 * Обновляет метаданные плана (название, этаж, корпус, секция).
 */
export async function updatePlan(
  planId: string,
  updates: { name?: string; floor?: string | null; building?: string | null; section?: string | null },
): Promise<PlanRecord> {
  const data = await apiFetch<{ plan: PlanRecord }>(`/api/plans/${planId}`, {
    method: 'PATCH',
    body: updates,
  })
  return data.plan
}

/**
 * Заменяет PDF-файл плана. Объект всегда перезаписывается в Cloud.ru:
 * если ранее план был в R2, после замены он окажется в Cloud.ru, поэтому
 * `storage` обновляется на 'cloudru'.
 */
export async function replacePlanFile(
  plan: PlanRecord,
  newFile: File,
  pageCount: number | null,
): Promise<PlanRecord> {
  const presigned = await requestPresigned({
    op: 'put',
    kind: 'plan',
    key: plan.r2_key,
    projectId: plan.project_id,
    planId: plan.id,
    contentType: 'application/pdf',
  })
  await putToPresigned(presigned, newFile)

  const data = await apiFetch<{ plan: PlanRecord }>(`/api/plans/${plan.id}`, {
    method: 'PATCH',
    body: { page_count: pageCount, storage: 'cloudru' },
  })

  // Инвалидируем локальный кэш
  const db = await getDB()
  await db.delete('plans_cache', plan.id)

  return data.plan
}

/**
 * Удаляет план: сначала из БД, потом файл из объектного хранилища, потом
 * IDB-кэш. Если план привязан к report_plan_marks (FK RESTRICT) — бросает
 * понятную ошибку.
 */
export async function deletePlan(plan: PlanRecord): Promise<void> {
  // 1. Удаляем из БД (FK violation возвращает 422 PLAN_IN_USE)
  try {
    await apiFetch(`/api/plans/${plan.id}`, { method: 'DELETE' })
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'PLAN_IN_USE') {
      throw new Error('Невозможно удалить план: к нему привязаны отметки отчётов. Удалите связанные отчёты и повторите.')
    }
    throw e
  }

  // 2. Удаляем файл из объектного хранилища (best-effort).
  try {
    const presigned = await requestPresigned({
      op: 'delete',
      kind: 'plan',
      key: plan.r2_key,
      projectId: plan.project_id,
      planId: plan.id,
      provider: plan.storage ?? 'cloudru',
    })
    await fetch(presigned.url, { method: presigned.method, headers: presigned.headers })
  } catch {
    // cleanup — не блокируем
  }

  // 3. Чистим IDB-кэш
  const db = await getDB()
  await db.delete('plans_cache', plan.id)
}

/**
 * Возвращает PDF-blob: сначала смотрит локальный кэш, иначе тянет через
 * presigned GET и сохраняет в `plans_cache` для офлайна. Провайдер
 * хранилища берётся из колонки `storage` (по умолчанию — 'cloudru').
 */
export async function downloadPlanPdf(plan: PlanRecord): Promise<Blob> {
  const db = await getDB()
  const cached = await db.get('plans_cache', plan.id)
  if (cached) return cached.blob

  const presigned = await requestPresigned({
    op: 'get',
    kind: 'plan',
    key: plan.r2_key,
    projectId: plan.project_id,
    planId: plan.id,
    provider: plan.storage ?? 'cloudru',
  })
  const blob = await getFromPresigned(presigned)
  await db.put('plans_cache', { id: plan.id, blob, cachedAt: Date.now() })
  return blob
}
