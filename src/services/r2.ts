import { supabase } from '@/lib/supabase'

export type R2Op = 'put' | 'get' | 'delete'
export type R2Kind = 'photo' | 'photo_thumb' | 'plan'

export interface PresignRequest {
  op: R2Op
  kind: R2Kind
  key: string
  reportId?: string
  projectId?: string
  planId?: string
  contentType?: string
}

export interface PresignResponse {
  url: string
  method: 'PUT' | 'GET' | 'DELETE'
  headers: Record<string, string>
  expiresAt: number
}

/**
 * Запрашивает у Supabase Edge Function `sign` presigned URL для R2.
 * Никаких R2-секретов на клиенте — функция валидирует JWT и проверяет права
 * через supabase-js + RLS, после чего подписывает короткоживущий URL.
 * Authorization-заголовок и apikey добавляет сам supabase-js.
 */
export async function requestPresigned(req: PresignRequest): Promise<PresignResponse> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.access_token) {
    throw new Error('Нет активной сессии Supabase для запроса presigned URL')
  }

  const { data, error } = await supabase.functions.invoke<PresignResponse>('sign', {
    body: req,
  })
  if (error) {
    // FunctionsHttpError содержит response — попытаемся вытащить JSON-сообщение,
    // чтобы пользователь видел «нет доступа к отчёту», а не голый «non-2xx».
    const detail = await extractFunctionErrorMessage(error)
    throw new Error(`presign: ${detail}`)
  }
  if (!data) throw new Error('presign: пустой ответ функции')
  return data
}

async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const anyErr = error as { message?: string; context?: { json?: () => Promise<unknown> } }
  try {
    const ctx = anyErr.context
    if (ctx && typeof ctx.json === 'function') {
      const body = (await ctx.json()) as { error?: string } | null
      if (body && typeof body.error === 'string' && body.error) return body.error
    }
  } catch {
    // Ignore — вернём fallback ниже.
  }
  return anyErr.message ?? 'unknown function error'
}

export function photoKey(reportId: string, photoId: string): string {
  return `photos/${reportId}/${photoId}.jpg`
}

export function photoThumbKey(reportId: string, photoId: string): string {
  return `photos/${reportId}/${photoId}-thumb.jpg`
}

export function planKey(projectId: string, planId: string): string {
  return `plans/${projectId}/${planId}.pdf`
}

// Таймаут на R2 PUT/GET: мобильные сети иногда «залипают» на минуты,
// мы не хотим, чтобы зависший запрос блокировал весь батч синхронизации.
// При timeout fetch бросает AbortError → sync-loop увеличит backoff и повторит.
const R2_PUT_TIMEOUT_MS = 60_000
const R2_GET_TIMEOUT_MS = 45_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`${label} timeout after ${timeoutMs}ms`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * PUT blob по presigned URL. Возвращает только при HTTP 2xx — иначе бросает,
 * чтобы sync-движок увеличил backoff.
 */
export async function putToPresigned(
  presigned: PresignResponse,
  body: Blob,
): Promise<void> {
  const res = await fetchWithTimeout(
    presigned.url,
    {
      method: presigned.method,
      headers: presigned.headers,
      body,
    },
    R2_PUT_TIMEOUT_MS,
    'R2 PUT',
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 PUT ${res.status}: ${text || res.statusText}`)
  }
}

export async function getFromPresigned(presigned: PresignResponse): Promise<Blob> {
  const res = await fetchWithTimeout(
    presigned.url,
    {
      method: presigned.method,
      headers: presigned.headers,
    },
    R2_GET_TIMEOUT_MS,
    'R2 GET',
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 GET ${res.status}: ${text || res.statusText}`)
  }
  return await res.blob()
}
