import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { getDB } from '@/lib/db'
import {
  getFromPresigned,
  planKey,
  putToPresigned,
  requestPresigned,
  type StorageProvider,
} from '@/services/r2'

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
 * Загружает PDF-план в приватный бакет Cloud.ru S3 и регистрирует его
 * в Supabase. Все новые планы записываются с `storage='cloudru'`.
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

  const { data, error } = await supabase
    .from('plans')
    .insert({
      id: planId,
      project_id: projectId,
      name,
      floor,
      building,
      section,
      r2_key: key,
      page_count: pageCount,
      storage: 'cloudru',
    })
    .select('*')
    .single()
  if (error) throw new Error(`plans insert: ${error.message}`)
  return data as PlanRecord
}

export async function listPlansForProject(projectId: string): Promise<PlanRecord[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanRecord[]
}

export async function listAllVisiblePlans(): Promise<PlanRecord[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanRecord[]
}

/**
 * Обновляет метаданные плана (название, этаж, корпус, секция).
 */
export async function updatePlan(
  planId: string,
  updates: { name?: string; floor?: string | null; building?: string | null; section?: string | null },
): Promise<PlanRecord> {
  const { data, error } = await supabase
    .from('plans')
    .update(updates)
    .eq('id', planId)
    .select('*')
    .single()
  if (error) throw new Error(`plans update: ${error.message}`)
  return data as PlanRecord
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

  const { data, error } = await supabase
    .from('plans')
    .update({ page_count: pageCount, storage: 'cloudru' })
    .eq('id', plan.id)
    .select('*')
    .single()
  if (error) throw new Error(`plans update: ${error.message}`)

  // Инвалидируем локальный кэш
  const db = await getDB()
  await db.delete('plans_cache', plan.id)

  return data as PlanRecord
}

/**
 * Удаляет план: сначала из БД, потом файл из объектного хранилища, потом
 * IDB-кэш. Если план привязан к report_plan_marks (FK RESTRICT) — бросает
 * понятную ошибку.
 */
export async function deletePlan(plan: PlanRecord): Promise<void> {
  // 1. Удаляем из БД (FK violation ловим)
  const { error } = await supabase
    .from('plans')
    .delete()
    .eq('id', plan.id)
  if (error) {
    if (error.code === '23503') {
      throw new Error('Невозможно удалить план: к нему привязаны отметки отчётов. Удалите связанные отчёты и повторите.')
    }
    throw new Error(`plans delete: ${error.message}`)
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
