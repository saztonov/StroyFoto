import { supabase } from '@/lib/supabase'
import type { Profile, Role } from '@/entities/profile/types'

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
 * Загружает профиль текущего пользователя.
 * Если в таблице profiles записи ещё нет (например, миграции не применены
 * или администратор не создал профиль) — возвращает синтетический
 * неактивный профиль, чтобы каркас приложения корректно отправил
 * пользователя на /pending-activation вместо падения.
 */
export async function loadProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    // Таблица ещё не создана или RLS отказала — не падаем, трактуем как неактивный.
    // Реальные проверки дублируются на уровне RLS, поэтому клиентский fallback безопасен.
    console.warn('[auth] Не удалось загрузить профиль:', error.message)
    return { id: userId, full_name: null, role: 'user', is_active: false }
  }

  if (!data) {
    return { id: userId, full_name: null, role: 'user', is_active: false }
  }

  return {
    id: data.id,
    full_name: data.full_name ?? null,
    role: (data.role as Role) ?? 'user',
    is_active: Boolean(data.is_active),
  }
}
