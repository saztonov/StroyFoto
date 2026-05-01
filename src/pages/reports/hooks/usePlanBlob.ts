import { useEffect, useState } from 'react'
import { getDB } from '@/lib/db'
import { downloadPlanPdf, planRowToRecord } from '@/services/plans'
import type { PlanRow } from '@/services/catalogs'

interface Result {
  planBlob: Blob | null
  planError: string | null
  planCachedOffline: boolean
}

/**
 * Подтягивает PDF-blob нужного плана через downloadPlanPdf (с кэшем в IDB),
 * а также флаг наличия плана в офлайн-кэше — для индикации в UI.
 */
export function usePlanBlob(targetPlanId: string | null | undefined, plans: PlanRow[]): Result {
  const [planBlob, setPlanBlob] = useState<Blob | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planCachedOffline, setPlanCachedOffline] = useState(false)

  useEffect(() => {
    if (!targetPlanId) {
      setPlanCachedOffline(false)
      setPlanBlob(null)
      setPlanError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const db = await getDB()
        const cached = await db.get('plans_cache', targetPlanId)
        if (!cancelled) setPlanCachedOffline(Boolean(cached))

        const planRow = plans.find((p) => p.id === targetPlanId)
        if (!planRow) {
          // нет метаданных плана → показать только координаты, blob не грузим
          if (!cancelled) setPlanBlob(null)
          return
        }
        const b = await downloadPlanPdf(planRowToRecord(planRow))
        if (!cancelled) setPlanBlob(b)
      } catch (e) {
        if (!cancelled) setPlanError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [targetPlanId, plans])

  return { planBlob, planError, planCachedOffline }
}
