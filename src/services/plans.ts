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
  r2_key: string
  page_count: number | null
  created_at: string
}

export function planDisplayName(plan: Pick<PlanRecord, 'name' | 'floor'>): string {
  return plan.floor ? `Этаж ${plan.floor} — ${plan.name}` : plan.name
}

/**
 * Загружает PDF-план в приватный R2 и регистрирует его в Supabase. Доступно
 * только администратору — RLS на `plans` это подтвердит при INSERT, а Worker
 * откажет в presign, если профиль не админ.
 */
export async function uploadPlanPdf(
  file: File,
  projectId: string,
  name: string,
  floor: string | null,
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
  // RLS сам отфильтрует по членству в проекте.
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanRecord[]
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
