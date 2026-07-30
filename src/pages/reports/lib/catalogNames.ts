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
