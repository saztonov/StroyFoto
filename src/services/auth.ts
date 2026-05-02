import {
  ApiError,
  apiFetch,
  setAccessToken,
  type SessionResponse,
} from '@/lib/apiClient'
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@/lib/authStorage'
import type { Profile, Role } from '@/entities/profile/types'
import { errors } from '@/shared/i18n/ru'
import { setCachedProfile } from '@/services/profileCache'

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30d (как у backend по умолчанию)

function profileFromResponse(p: SessionResponse['profile']): Profile {
  return {
    id: p.id,
    full_name: p.full_name ?? null,
    role: (p.role as Role) ?? 'user',
    is_active: Boolean(p.is_active),
  }
}

async function applySession(data: SessionResponse): Promise<Profile> {
  setAccessToken(data.session.access_token, data.session.expires_at)
  if (data.session.refresh_token) {
    await saveAuthSession({
      userId: data.session.user.id,
      email: data.session.user.email,
      refreshToken: data.session.refresh_token,
      refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
    })
  }
  const profile = profileFromResponse(data.profile)
  void setCachedProfile(profile)
  return profile
}

export interface AuthResult {
  user: { id: string; email: string }
  profile: Profile
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult> {
  const data = await apiFetch<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
    auth: false,
  })
  const profile = await applySession(data)
  return { user: data.session.user, profile }
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName?: string,
): Promise<AuthResult> {
  const data = await apiFetch<SessionResponse>('/api/auth/register', {
    method: 'POST',
    body: {
      email: email.trim(),
      password,
      ...(fullName ? { fullName: fullName.trim() } : {}),
    },
    auth: false,
  })
  const profile = await applySession(data)
  return { user: data.session.user, profile }
}

export async function signOut(): Promise<void> {
  const session = await loadAuthSession()
  try {
    if (session?.refreshToken) {
      await apiFetch<{ ok: true }>('/api/auth/logout', {
        method: 'POST',
        body: { refresh_token: session.refreshToken },
      })
    }
  } catch {
    // даже если сервер недоступен — локально гасим сессию
  } finally {
    await clearAuthSession()
    setAccessToken(null, null)
  }
}

/**
 * Восстанавливает сессию при старте приложения через сохранённый refresh-токен.
 * Возвращает null, если refresh не валиден или просрочен.
 */
export async function restoreSession(): Promise<AuthResult | null> {
  const stored = await loadAuthSession()
  if (!stored?.refreshToken) return null
  if (stored.refreshExpiresAt < Date.now()) {
    await clearAuthSession()
    return null
  }
  try {
    const data = await apiFetch<SessionResponse>('/api/auth/refresh', {
      method: 'POST',
      body: { refresh_token: stored.refreshToken },
      auth: false,
      skipRefresh: true,
    })
    const profile = await applySession(data)
    return { user: data.session.user, profile }
  } catch {
    await clearAuthSession()
    setAccessToken(null, null)
    return null
  }
}

/**
 * Загружает профиль текущего пользователя через /api/profile.
 * Использует уже выставленный access-токен.
 */
export async function loadProfile(_userId: string): Promise<Profile> {
  const data = await apiFetch<SessionResponse>('/api/profile')
  const profile = profileFromResponse(data.profile)
  void setCachedProfile(profile)
  return profile
}

/**
 * Обновляет ФИО текущего пользователя.
 */
export async function updateMyFullName(fullName: string): Promise<Profile> {
  const data = await apiFetch<SessionResponse>('/api/profile', {
    method: 'PATCH',
    body: { full_name: fullName },
  })
  const profile = profileFromResponse(data.profile)
  void setCachedProfile(profile)
  return profile
}

/**
 * Маппинг ошибок ApiError и сети на русские сообщения для UI.
 */
export function mapAuthError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'INVALID_CREDENTIALS') return errors.invalidCredentials
    if (e.code === 'USER_EXISTS') return errors.userExists
    if (e.code === 'INACTIVE_USER') return errors.emailNotConfirmed ?? e.message
    if (e.status === 0 || e.status >= 500) return errors.network
    return e.message || errors.generic
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
