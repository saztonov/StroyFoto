import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { getDB } from '@/lib/db'
import {
  getFromPresigned,
  planKey,
  putToPresigned,
  requestPresigned,
} from '@/services/r2'

export interface PlanRecord {
  id: string
  project_id: string
  name: string
  floor: string | null
  building: string | null
  section: string | null
  r2_key: string
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
 * Загружает PDF-план в приватный R2 и регистрирует его в Supabase.
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
 * Заменяет PDF-файл плана. R2 key остаётся прежним (перезапись),
 * IDB-кэш инвалидируется.
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

  // Обновляем page_count в БД
  const { data, error } = await supabase
    .from('plans')
    .update({ page_count: pageCount })
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
 * Удаляет план: сначала из БД, потом файл из R2, потом IDB-кэш.
 * Если план привязан к report_plan_marks (FK RESTRICT) — бросает понятную ошибку.
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

  // 2. Удаляем файл из R2 (best-effort)
  try {
    const presigned = await requestPresigned({
      op: 'delete',
      kind: 'plan',
      key: plan.r2_key,
      projectId: plan.project_id,
      planId: plan.id,
    })
    await fetch(presigned.url, { method: presigned.method, headers: presigned.headers })
  } catch {
    // R2 cleanup — не блокируем
  }

  // 3. Чистим IDB-кэш
  const db = await getDB()
  await db.delete('plans_cache', plan.id)
}

/**
 * Возвращает PDF-blob: сначала смотрит локальный кэш, иначе тянет через
 * presigned GET и сохраняет в `plans_cache` для офлайна.
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
  })
  const blob = await getFromPresigned(presigned)
  await db.put('plans_cache', { id: plan.id, blob, cachedAt: Date.now() })
  return blob
}
