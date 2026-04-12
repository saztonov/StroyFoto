import { AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, Role } from '@/entities/profile/types'
import { errors } from '@/shared/i18n/ru'
import { setCachedProfile } from '@/services/profileCache'

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
  return data
}

export async function signUpWithEmail(email: string, password: string, fullName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: fullName ? { full_name: fullName.trim() } : undefined,
    },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * Загружает профиль текущего пользователя из таблицы profiles.
 *
 * Если строка ещё не создана триггером handle_new_user (мгновение после signup) —
 * возвращает синтетический неактивный профиль, чтобы UI отправил пользователя
 * на /pending-activation. Реальные ошибки (сеть, RLS, БД) пробрасываются наверх,
 * чтобы вызывающий мог отличить «нет профиля» от «не смогли загрузить».
 */
export async function loadProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    return { id: userId, full_name: null, role: 'user', is_active: false }
  }

  const profile: Profile = {
    id: data.id,
    full_name: data.full_name ?? null,
    role: (data.role as Role) ?? 'user',
    is_active: Boolean(data.is_active),
  }

  void setCachedProfile(profile)

  return profile
}

/**
 * Маппинг типовых ошибок Supabase Auth и сети на русские сообщения для UI.
 */
export function mapAuthError(e: unknown): string {
  if (e instanceof AuthError) {
    const msg = e.message.toLowerCase()
    if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
      return errors.invalidCredentials
    }
    if (msg.includes('email not confirmed')) {
      return errors.emailNotConfirmed
    }
    if (msg.includes('already registered') || msg.includes('user already')) {
      return errors.userExists
    }
    if (msg.includes('password should be') || msg.includes('weak password')) {
      return errors.weakPassword
    }
    return e.message
  }

  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return errors.network
  }

  if (e instanceof Error) {
    if (/failed to fetch|networkerror|network request failed/i.test(e.message)) {
      return errors.network
    }
    return e.message || errors.generic
  }

  return errors.generic
}
