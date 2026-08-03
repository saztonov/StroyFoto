import type { ReportCard, ReportPerformer } from './types'

/**
 * Единый фолбэк для записей, созданных до появления множественных подрядчиков.
 * Такие черновики и снапшоты лежат в IndexedDB без `performerIds`, и версию
 * базы под них не поднимали — значит разбирать этот случай приходится в рантайме.
 * Держим его в одном месте, чтобы `?? [performerId]` не расползался по коду.
 */
export function reportPerformerIds(card: {
  performerId: string
  performerIds?: string[]
}): string[] {
  const ids = card.performerIds
  return ids && ids.length > 0 ? ids : [card.performerId]
}

/**
 * Имена подрядчиков отчёта. Порядок приоритета тот же, что у имён справочников:
 * сперва то, что отдал сервер (там есть и архивные позиции), затем локальный
 * справочник, и только потом заглушка.
 */
export function reportPerformerNames(
  card: Pick<ReportCard, 'performerId' | 'performerIds' | 'performers'>,
  resolve: (id: string) => string | undefined,
  fallback = '—',
): string[] {
  const byId = new Map<string, ReportPerformer>(
    (card.performers ?? []).map((p) => [p.id, p]),
  )
  return reportPerformerIds(card).map(
    (id) => byId.get(id)?.name ?? resolve(id) ?? fallback,
  )
}
