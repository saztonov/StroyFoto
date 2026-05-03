import { env } from '@/shared/config/env'
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '@/lib/authStorage'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ServerErrorBody {
  error?: { code?: string; message?: string; details?: unknown }
}

interface AccessState {
  token: string | null
  expiresAtSec: number | null
}

const access: AccessState = { token: null, expiresAtSec: null }

let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(handler: () => void): void {
  onUnauthorized = handler
}

export function setAccessToken(token: string | null, expiresAtSec: number | null): void {
  access.token = token
  access.expiresAtSec = expiresAtSec
}

export function getAccessToken(): string | null {
  return access.token
}

export function getAccessExpSec(): number | null {
  return access.expiresAtSec
}

export interface SessionResponse {
  session: {
    access_token: string
    refresh_token?: string
    expires_at: number
    user: { id: string; email: string }
  }
  profile: {
    id: string
    full_name: string | null
    role: 'admin' | 'user'
    is_active: boolean
  }
}

function joinUrl(path: string): string {
  if (path.startsWith('http')) return path
  if (path.startsWith('/api')) {
    // env.apiBaseUrl уже '/api' или 'http://...:4000/api' — обрезаем '/api' префикс,
    // чтобы не задвоить.
    const base = env.apiBaseUrl
    const tail = path.slice('/api'.length)
    return base + tail
  }
  return env.apiBaseUrl + (path.startsWith('/') ? path : `/${path}`)
}

// Дефолтные таймауты. На GPRS/слабом 3G fetch без AbortController может
// зависнуть на минуты, блокируя весь sync-loop (sync.ts: `if (running) return`).
// Перекрывается через ApiFetchOptions.timeoutMs.
const DEFAULT_API_TIMEOUT_MS = 30_000
const REFRESH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  // Если caller уже передал signal — оборачиваем оба сигнала. Иначе используем
  // только наш таймаут.
  const controller = new AbortController()
  const externalSignal = init.signal
  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error(`${label} timeout ${timeoutMs}ms`)), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      // Оба источника — наш timeout и external abort — превращаем в ApiError(0, 'TIMEOUT').
      // Sync-loop classify его как transient → exponential backoff retry.
      throw new ApiError(0, 'TIMEOUT', `${label} timeout after ${timeoutMs}ms`)
    }
    throw e
  } finally {
    clearTimeout(timer)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }
}

let refreshing: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const session = await loadAuthSession()
      if (!session?.refreshToken) return false
      const url = joinUrl('/api/auth/refresh')
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refreshToken }),
        },
        REFRESH_TIMEOUT_MS,
        'API refresh',
      )
      if (!res.ok) return false
      const data = (await res.json()) as SessionResponse
      const refreshExpiresAt =
        Date.now() + 30 /*days*/ * 24 * 60 * 60 * 1000
      if (data.session.refresh_token) {
        await saveAuthSession({
          userId: data.session.user.id,
          email: data.session.user.email,
          refreshToken: data.session.refresh_token,
          refreshExpiresAt,
          // Прозрачный refresh не должен «повышать» session-only токен
          // до персистентного. Старые записи без поля считаем persistent: true.
          persistent: session.persistent ?? true,
        })
      }
      setAccessToken(data.session.access_token, data.session.expires_at)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /**
   * По умолчанию все запросы кладут Authorization: Bearer <access>.
   * Поставьте false для логина/регистрации/refresh, где токена ещё нет.
   */
  auth?: boolean
  /** Если true — не пытаемся обновить access по 401 (используется в самом /refresh). */
  skipRefresh?: boolean
  /** Таймаут запроса в мс. По умолчанию 30 секунд. */
  timeoutMs?: number
}

async function performFetch(
  path: string,
  options: ApiFetchOptions,
): Promise<Response> {
  const url = joinUrl(path)
  const headers = new Headers(options.headers as HeadersInit | undefined)
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.auth !== false) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const init: RequestInit = {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS
  return fetchWithTimeout(url, init, timeoutMs, `API ${options.method ?? 'GET'} ${path}`)
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  let res = await performFetch(path, options)

  if (
    res.status === 401 &&
    options.auth !== false &&
    !options.skipRefresh
  ) {
    const ok = await tryRefresh()
    if (ok) {
      res = await performFetch(path, options)
    } else {
      await clearAuthSession()
      setAccessToken(null, null)
      onUnauthorized?.()
    }
  }

  if (!res.ok) {
    let body: ServerErrorBody | null = null
    try {
      body = (await res.json()) as ServerErrorBody
    } catch {
      // non-JSON response
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `Ошибка ${res.status}`,
      body?.error?.details,
    )
  }

  // 204 No Content
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return undefined as T
  return (await res.json()) as T
}
