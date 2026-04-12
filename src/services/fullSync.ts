import { getDB } from '@/lib/db'
import { loadProjectsForUser, loadWorkTypes, loadPerformers, loadPlansForProject } from '@/services/catalogs'
import { downloadPlanPdf, type PlanRecord } from '@/services/plans'
import { loadMergedReports } from '@/services/reports'
import { runSyncOnce } from '@/services/sync'
import { getRetention } from '@/services/deviceSettings'
import { reconcile } from '@/services/reconcile'

export interface FullSyncProgress {
  phase: string
  phaseLabel: string
  current: number
  total: number
}

export interface FullSyncResult {
  catalogsRefreshed: boolean
  plansDownloaded: number
  plansSkipped: number
  planErrors: number
  reportsCached: number
}

/**
 * Скачивает все PDF-планы по проектам пользователя, которые ещё не закэшированы.
 * Скачивание последовательное — не перегружаем сеть и память на мобильном.
 */
export async function syncAllPlansForUser(
  onProgress?: (done: number, total: number) => void,
): Promise<{ downloaded: number; skipped: number; errors: number }> {
  const projects = await loadProjectsForUser()

  // Собираем метаданные планов по всем проектам
  const allPlans: Array<{ id: string; project_id: string; r2_key: string }> = []
  for (const project of projects) {
    const plans = await loadPlansForProject(project.id)
    for (const p of plans) {
      allPlans.push({ id: p.id, project_id: p.project_id, r2_key: p.r2_key })
    }
  }

  // Читаем уже закэшированные ID одним запросом
  const db = await getDB()
  const cachedIds = new Set(await db.getAllKeys('plans_cache'))

  const toDownload = allPlans.filter((p) => !cachedIds.has(p.id))
  const total = allPlans.length
  let downloaded = 0
  let errors = 0
  const skipped = allPlans.length - toDownload.length

  onProgress?.(skipped, total)

  for (const plan of toDownload) {
    try {
      await downloadPlanPdf(plan as unknown as PlanRecord)
      downloaded += 1
    } catch (e) {
      console.warn('syncAllPlansForUser: не удалось скачать план', plan.id, e)
      errors += 1
    }
    onProgress?.(skipped + downloaded + errors, total)
  }

  return { downloaded, skipped, errors }
}

/**
 * Полная двусторонняя синхронизация:
 * 1. Push — отправка локальных данных на сервер
 * 2. Справочники — проекты, виды работ, исполнители
 * 3. Планы — метаданные + скачивание PDF
 * 4. Отчёты — загрузка и кэширование с сервера
 */
export async function fullSync(
  onProgress?: (p: FullSyncProgress) => void,
): Promise<FullSyncResult> {
  const result: FullSyncResult = {
    catalogsRefreshed: false,
    plansDownloaded: 0,
    plansSkipped: 0,
    planErrors: 0,
    reportsCached: 0,
  }

  // Фаза 1: Push
  onProgress?.({ phase: 'push', phaseLabel: 'Отправка данных на сервер', current: 0, total: 1 })
  await runSyncOnce()
  onProgress?.({ phase: 'push', phaseLabel: 'Отправка данных на сервер', current: 1, total: 1 })

  // Фаза 2: Reconcile — подтягиваем серверные данные + справочники через единый pipeline
  onProgress?.({ phase: 'catalogs', phaseLabel: 'Обновление справочников и отчётов', current: 0, total: 3 })
  await reconcile()
  // Дополнительно принудительно обновляем справочники (reconcile может использовать stale cache)
  await Promise.all([
    loadProjectsForUser(true),
    loadWorkTypes(true),
    loadPerformers(true),
  ])
  result.catalogsRefreshed = true
  onProgress?.({ phase: 'catalogs', phaseLabel: 'Обновление справочников и отчётов', current: 3, total: 3 })

  // Фаза 3+4: Планы (метаданные обновляются внутри syncAllPlansForUser → loadPlansForProject)
  onProgress?.({ phase: 'plans', phaseLabel: 'Скачивание планов', current: 0, total: 0 })
  const planResult = await syncAllPlansForUser((done, total) => {
    onProgress?.({ phase: 'plans', phaseLabel: 'Скачивание планов', current: done, total })
  })
  result.plansDownloaded = planResult.downloaded
  result.plansSkipped = planResult.skipped
  result.planErrors = planResult.errors

  // Фаза 5: Отчёты (если retention не 'none')
  const retention = await getRetention()
  if (retention.mode !== 'none') {
    onProgress?.({ phase: 'reports', phaseLabel: 'Загрузка отчётов', current: 0, total: 1 })
    const { cards } = await loadMergedReports()
    result.reportsCached = cards.length
    onProgress?.({ phase: 'reports', phaseLabel: 'Загрузка отчётов', current: 1, total: 1 })
  }

  return result
}
