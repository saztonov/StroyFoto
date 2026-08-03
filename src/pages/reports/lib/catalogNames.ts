/**
 * Имя позиции справочника для отображения.
 *
 * Основной источник — имя, пришедшее с сервера вместе с отчётом. Резолв по
 * клиентскому справочнику остаётся только запасным вариантом: списки грузятся
 * с `?active=true`, поэтому архивная позиция в них отсутствует, и историчный
 * отчёт отображался бы как «—», хотя данные целы.
 *
 * Запасной путь нужен для локальных черновиков: их сервер ещё не видел, имени
 * в карточке нет, зато позиция заведомо активна и лежит в локальном списке.
 */
export function resolveCatalogName(
  serverName: string | null | undefined,
  id: string | null | undefined,
  lookup: (id: string) => string | undefined,
): string | null {
  if (serverName) return serverName
  if (!id) return null
  return lookup(id) ?? null
}

/**
 * Подписи подрядчиков отчёта — по одной на каждого, в порядке «основной первым».
 *
 * Вид (подрядчик / собственные силы) известен только из клиентского справочника,
 * а он грузится с `?active=true`. Для архивного исполнителя вида не будет, но имя
 * придёт с сервера — поэтому суффикс добавляется лишь когда вид действительно
 * найден, а не подставляется наугад.
 */
export function resolvePerformerLabels(
  card: {
    performerId: string
    performerIds?: string[]
    performers?: Array<{ id: string; name: string }>
  },
  lookup: (id: string) => { name: string; kind: string } | undefined,
  labels: { contractor: string; own: string },
): string[] {
  const ids =
    card.performerIds && card.performerIds.length > 0
      ? card.performerIds
      : [card.performerId]
  const serverNames = new Map((card.performers ?? []).map((p) => [p.id, p.name]))

  return ids.map((id) => {
    const local = lookup(id)
    const name = serverNames.get(id) ?? local?.name
    if (!name) return '—'
    if (!local) return name
    return `${name} · ${
      local.kind === 'contractor' ? labels.contractor : labels.own
    }`
  })
}
