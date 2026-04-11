import { supabase } from '@/lib/supabase'
import { env } from '@/shared/config/env'

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
 * Запрашивает у доверенного Cloudflare Worker presigned URL для R2.
 * Никаких R2-секретов на клиенте — Worker валидирует JWT и проверяет права
 * через Supabase REST + RLS, после чего подписывает короткоживущий URL.
 */
export async function requestPresigned(req: PresignRequest): Promise<PresignResponse> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Нет активной сессии Supabase для запроса presigned URL')

  const res = await fetch(`${env.presignUrl}/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`presign ${res.status}: ${text || res.statusText}`)
  }

  return (await res.json()) as PresignResponse
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
