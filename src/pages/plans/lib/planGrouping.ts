import type { PlanRecord } from '@/services/plans'

/** Группировка планов по корпус → секция */
export interface PlanGroup {
  building: string
  sections: { section: string; plans: PlanRecord[] }[]
}

export function groupPlans(plans: PlanRecord[]): PlanGroup[] | null {
  const hasGrouping = plans.some((p) => p.building || p.section)
  if (!hasGrouping) return null

  const map = new Map<string, Map<string, PlanRecord[]>>()
  for (const p of plans) {
    const b = p.building || ''
    const s = p.section || ''
    if (!map.has(b)) map.set(b, new Map())
    const secMap = map.get(b)!
    if (!secMap.has(s)) secMap.set(s, [])
    secMap.get(s)!.push(p)
  }

  const result: PlanGroup[] = []
  for (const [building, secMap] of map) {
    const sections: PlanGroup['sections'] = []
    for (const [section, plans] of secMap) {
      sections.push({ section, plans })
    }
    result.push({ building, sections })
  }
  return result
}
