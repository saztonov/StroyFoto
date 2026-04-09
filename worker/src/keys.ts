// Валидация формы R2 object keys. Никаких "../", только наши паттерны.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const PHOTO_RE = new RegExp(`^photos/(${UUID})/(${UUID})\\.jpg$`)
const PHOTO_THUMB_RE = new RegExp(`^photos/(${UUID})/(${UUID})-thumb\\.jpg$`)
const PLAN_RE = new RegExp(`^plans/(${UUID})/(${UUID})\\.pdf$`)

export type Kind = 'photo' | 'photo_thumb' | 'plan'

export interface ParsedKey {
  kind: Kind
  // Для photo: parent = reportId; для plan: parent = projectId
  parent: string
  entity: string
}

export function parseKey(kind: Kind, key: string): ParsedKey | null {
  let m: RegExpMatchArray | null = null
  if (kind === 'photo') m = key.match(PHOTO_RE)
  else if (kind === 'photo_thumb') m = key.match(PHOTO_THUMB_RE)
  else if (kind === 'plan') m = key.match(PLAN_RE)
  if (!m) return null
  return { kind, parent: m[1], entity: m[2] }
}
