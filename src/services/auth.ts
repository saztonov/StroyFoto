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

async function applySession(
  data: SessionResponse,
  options: { persistent: boolean },
): Promise<Profile> {
  // Запись refresh-токена и установка access-токена — одной операцией под
  // общим замком сессии: иначе конкурирующий tryRefresh мог бы вклиниться
  // между ними и оставить токены от разных сессий.
  await saveAuthSession(
    data.session.refresh_token
      ? {
          userId: data.session.user.id,
          email: data.session.user.email,
          refreshToken: data.session.refresh_token,
          refreshExpiresAt: Date.now() + REFRESH_TTL_MS,
          persistent: options.persistent,
        }
      : null,
    () => setAccessToken(data.session.access_token, data.session.expires_at),
  )
  const profile = profileFromResponse(data.profile)
  void setCachedProfile(profile)
  return profile
}

export interface AuthResult {
  user: { id: string; email: string }
  profile: Profile
}

/**
 * Применяет полученную сессию к устройству.
 *
 * Вынесено из signIn/signUp намеренно: решение «принимать эту сессию или нет»
 * зависит от того, чьи данные лежат на устройстве, а это знание живёт в
 * AuthProvider. Поэтому сервисы возвращают сырой ответ, а применяет его
 * adoptSession провайдера.
 */
export async function applyAuthSession(
  data: SessionResponse,
  options: { persistent: boolean },
): Promise<AuthResult> {
  const profile = await applySession(data, options)
  return { user: data.session.user, profile }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
    auth: false,
  })
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName?: string,
): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/api/auth/register', {
    method: 'POST',
    body: {
      email: email.trim(),
      password,
      ...(fullName ? { fullName: fullName.trim() } : {}),
    },
    auth: false,
  })
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
    await clearAuthSession(() => setAccessToken(null, null))
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
    // Сохраняем тот же режим, что был у исходной записи. Старые записи без
    // поля persistent трактуем как persistent: true (обратная совместимость).
    const profile = await applySession(data, {
      persistent: stored.persistent ?? true,
    })
    return { user: data.session.user, profile }
  } catch {
    await clearAuthSession(() => setAccessToken(null, null))
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
 * Оставляет заявку на сброс пароля.
 *
 * Ответ сервера одинаков и для известного адреса, и для неизвестного — так и
 * задумано, иначе форма превращается в проверялку зарегистрированных адресов.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email: email.trim() },
    auth: false,
  })
}

export interface ResetTokenInfo {
  email_masked: string
  expires_at: string
}

/** Проверяет ссылку перед показом формы. Токен при этом не расходуется. */
export async function checkResetToken(token: string): Promise<ResetTokenInfo> {
  return apiFetch<ResetTokenInfo>('/api/auth/password-reset/check', {
    method: 'POST',
    body: { token },
    auth: false,
    skipRefresh: true,
  })
}

/**
 * Задаёт новый пароль по ссылке.
 *
 * Сессию НЕ применяет: решение «принимать её на этом устройстве или нет»
 * зависит от того, чьи локальные данные тут лежат, и принимается на странице.
 */
export async function completePasswordReset(
  token: string,
  password: string,
): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, password },
    auth: false,
    skipRefresh: true,
  })
}

/**
 * Меняет пароль текущего пользователя.
 *
 * Сессию не применяет: сервер погасил ВСЕ токены и выдал новый именно этому
 * устройству, а принимает его adoptSession провайдера. Режим хранения
 * возвращается наружу, потому что прочитать его нужно ДО запроса — ответ
 * перезапишет запись сессии, а session-only сессию нельзя молча «повысить»
 * до персистентной.
 */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ data: SessionResponse; persistent: boolean }> {
  const stored = await loadAuthSession()
  const persistent = stored?.persistent ?? true
  const data = await apiFetch<SessionResponse>('/api/profile/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })
  return { data, persistent }
}

/**
 * Маппинг ошибок ApiError и сети на русские сообщения для UI.
 */
export function mapAuthError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'INVALID_CREDENTIALS') return errors.invalidCredentials
    if (e.code === 'USER_EXISTS') return errors.userExists
    if (e.code === 'INACTIVE_USER') return errors.emailNotConfirmed ?? e.message
    if (e.code === 'WEAK_PASSWORD') return errors.weakPassword
    if (e.code === 'PASSWORD_TOO_LONG') return errors.passwordTooLong
    if (e.code === 'INVALID_CURRENT_PASSWORD') return errors.invalidCurrentPassword
    if (e.code === 'PASSWORD_SAME') return errors.passwordSame
    if (e.code === 'PASSWORD_CHANGED_CONCURRENTLY') {
      return errors.passwordChangedConcurrently
    }
    if (e.code === 'RESET_TOKEN_INVALID') return errors.resetTokenInvalid
    if (e.code === 'RESET_TOKEN_EXPIRED') return errors.resetTokenExpired
    if (e.code === 'RESET_TOKEN_USED') return errors.resetTokenUsed
    if (e.code === 'RESET_ALREADY_CLOSED') return errors.resetAlreadyClosed
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
