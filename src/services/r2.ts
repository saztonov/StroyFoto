import { apiFetch } from '@/lib/apiClient'

/**
 * Идентификатор объектного хранилища, в котором лежит конкретный объект.
 *  - `cloudru` — Cloud.ru Object Storage (s3.cloud.ru, ru-central-1).
 *    Активный провайдер: все новые загрузки уходят сюда.
 *  - `r2` — Cloudflare R2. Легаси-провайдер; используется только для чтения
 *    исторических объектов и во время разовой миграции
 *    (см. `src/pages/admin/StorageMigrationPage.tsx`).
 *
 * Значение хранится в столбце `storage` таблиц `report_photos` и `plans`.
 */
export type StorageProvider = 'cloudru' | 'r2'

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
  /**
   * Провайдер хранилища. По умолчанию — `cloudru` (новый бакет в Cloud.ru).
   * Передавайте `r2` только для чтения/удаления исторических объектов из
   * Cloudflare R2 во время миграции.
   */
  provider?: StorageProvider
}

export interface PresignResponse {
  url: string
  method: 'PUT' | 'GET' | 'DELETE'
  headers: Record<string, string>
  expiresAt: number
  /** Подтверждение, в каком хранилище был выпущен URL (echo от сервера). */
  provider: StorageProvider
}

/**
 * Запрашивает у backend (POST /api/storage/presign) presigned URL.
 * Никаких секретов хранилища на клиенте — backend валидирует JWT,
 * проверяет права (автор отчёта / член проекта / админ), и подписывает
 * короткоживущий URL через SigV4.
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

// Таймаут на S3 PUT/GET: мобильные сети иногда «залипают» на минуты,
// мы не хотим, чтобы зависший запрос блокировал весь батч синхронизации.
// При timeout fetch бросает AbortError → sync-loop увеличит backoff и повторит.
const STORAGE_PUT_TIMEOUT_MS = 60_000
const STORAGE_GET_TIMEOUT_MS = 45_000

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
    STORAGE_PUT_TIMEOUT_MS,
    `S3 PUT (${presigned.provider})`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`S3 PUT (${presigned.provider}) ${res.status}: ${text || res.statusText}`)
  }
}

export async function getFromPresigned(presigned: PresignResponse): Promise<Blob> {
  const res = await fetchWithTimeout(
    presigned.url,
    {
      method: presigned.method,
      headers: presigned.headers,
    },
    STORAGE_GET_TIMEOUT_MS,
    `S3 GET (${presigned.provider})`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`S3 GET (${presigned.provider}) ${res.status}: ${text || res.statusText}`)
  }
  return await res.blob()
}
