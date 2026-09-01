/**
 * Достаёт токен сброса из фрагмента адреса.
 *
 * Токен живёт именно во fragment, а не в пути или query: браузер не отправляет
 * фрагмент ни на сервер, ни в заголовке Referer, поэтому в access-логе nginx
 * останется только «/reset-password» без секрета.
 */
export function parseResetToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const token = new URLSearchParams(raw).get('token')
  return token && token.trim() ? token : null
}
