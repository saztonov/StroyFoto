import { apiFetch } from '@/lib/apiClient'

export type StorageOp = 'put' | 'get' | 'delete'
export type StorageKind = 'photo' | 'photo_thumb' | 'plan'

export interface PresignRequest {
  op: StorageOp
  kind: StorageKind
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
 * Запрашивает у backend (POST /api/storage/presign) presigned URL для
 * Cloud.ru Object Storage. Никаких секретов хранилища на клиенте: backend
 * валидирует JWT, проверяет права (автор отчёта / член проекта / админ),
 * и подписывает короткоживущий URL через SigV4.
 */
export async function requestPresigned(req: PresignRequest): Promise<PresignResponse> {
  return apiFetch<PresignResponse>('/api/storage/presign', {
    method: 'POST',
    body: req,
  })
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

// Таймаут на S3 GET. PUT — адаптивный, см. computePutTimeoutMs ниже.
const STORAGE_GET_TIMEOUT_MS = 45_000

// Запас, на который presigned URL должен «пережить» предполагаемое
// время операции. На медленных мобильных сетях случаются длинные паузы
// между выпуском подписи и фактическим PUT (очередь sync-loop, ретраи
// API-вызова presign), поэтому 15 секунд — компромисс между ложной
// «свежестью» и ложным PRESIGN_EXPIRED_BEFORE_USE.
const PRESIGN_EXPIRY_BUFFER_MS = 15_000

// Адаптивный таймаут PUT: база 60с + размер/30KBs (3G uplink), зажат в
// [60с, 8 мин]. 8 мин укладываются в TTL 10 мин с буфером 15с.
export function computePutTimeoutMs(sizeBytes: number): number {
  const computed = 60_000 + Math.ceil(sizeBytes / 30)
  if (computed < 60_000) return 60_000
  if (computed > 480_000) return 480_000
  return computed
}

export class PresignExpiredError extends Error {
  code = 'PRESIGN_EXPIRED_BEFORE_USE' as const
  constructor() {
    super('Presigned URL expired before use')
    this.name = 'PresignExpiredError'
  }
}

// Сервер отдаёт expiresAt в Unix СЕКУНДАХ
// (server/src/services/presignService.ts: Math.floor(Date.now()/1000) + ttl).
// Date.now() — миллисекунды. Без этой нормализации сравнение
// Date.now() > expiresAt истинно для ЛЮБОГО только что выпущенного URL,
// и каждый PUT падал бы в PRESIGN_EXPIRED_BEFORE_USE до выхода в сеть.
function expiresAtMs(presigned: PresignResponse): number {
  return presigned.expiresAt * 1000
}

function ensurePresignFresh(presigned: PresignResponse, neededMs: number): void {
  if (!presigned.expiresAt) return
  if (Date.now() + neededMs + PRESIGN_EXPIRY_BUFFER_MS > expiresAtMs(presigned)) {
    throw new PresignExpiredError()
  }
}

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
 *
 * Перед PUT проверяем, что URL проживёт хотя бы STORAGE_PUT_TIMEOUT_MS — иначе
 * после долгого ожидания в очереди мы попадём на 403 Forbidden (URL expired)
 * и потеряем backoff впустую.
 */
export async function putToPresigned(
  presigned: PresignResponse,
  body: Blob,
): Promise<void> {
  const timeoutMs = computePutTimeoutMs(body.size)
  ensurePresignFresh(presigned, timeoutMs)
  const res = await fetchWithTimeout(
    presigned.url,
    {
      method: presigned.method,
      headers: presigned.headers,
      body,
    },
    timeoutMs,
    'S3 PUT',
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`S3 PUT ${res.status}: ${text || res.statusText}`)
  }
}

export async function getFromPresigned(presigned: PresignResponse): Promise<Blob> {
  ensurePresignFresh(presigned, STORAGE_GET_TIMEOUT_MS)
  const res = await fetchWithTimeout(
    presigned.url,
    {
      method: presigned.method,
      headers: presigned.headers,
    },
    STORAGE_GET_TIMEOUT_MS,
    'S3 GET',
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`S3 GET ${res.status}: ${text || res.statusText}`)
  }
  return await res.blob()
}
