export type PasswordResetStatus = 'pending' | 'issued' | 'used' | 'cancelled'

export interface PasswordResetRequest {
  id: string
  user_id: string
  email: string
  full_name: string | null
  status: PasswordResetStatus
  source: 'user' | 'admin'
  requested_at: string
  last_requested_at: string
  /** Сколько раз пользователь просил сброс. 0 — заявку завёл админ. */
  request_count: number
  token_issued_at: string | null
  token_expires_at: string | null
  /** Ссылка выдана, но срок вышел: для очереди это закрытая позиция. */
  link_expired: boolean
  used_at: string | null
  cancelled_at: string | null
}

/** Открытые заявки — те, что реально ждут действия администратора. */
export function isOpenRequest(r: PasswordResetRequest): boolean {
  if (r.status === 'pending') return true
  return r.status === 'issued' && !r.link_expired
}
