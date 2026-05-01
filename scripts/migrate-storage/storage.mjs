// Тонкие S3-обёртки поверх aws4fetch для CLI миграции.
//
// Поддерживаются:
//   - Cloud.ru Object Storage (https://s3.cloud.ru, region=ru-central-1,
//     accessKeyId=<tenant_id>:<key_id>) — целевой бакет.
//   - Cloudflare R2 (<account_id>.r2.cloudflarestorage.com, region=auto) —
//     источник для миграции.
//
// Не используем @aws-sdk/client-s3 чтобы не тащить ~2MB зависимостей ради
// четырёх HTTP-вызовов. Web Crypto + fetch есть нативно в Node 18+.

import { AwsClient } from 'aws4fetch'

/** Конфиг хранилища (общий для R2 и Cloud.ru, отличается только endpoint/region). */
/**
 * @typedef {{
 *   endpoint: string,
 *   region: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   bucket: string,
 * }} StorageConfig
 */

/**
 * Тайм-ауты сетевых операций. Гарантируем отсутствие «вечных» висящих
 * запросов даже если CDN/прокси замолчал — для CLI это критично, иначе
 * прогресс встаёт без обратной связи.
 */
const HEAD_TIMEOUT_MS = 20_000
const GET_TIMEOUT_MS = 60_000
const PUT_TIMEOUT_MS = 120_000
const DELETE_TIMEOUT_MS = 30_000

export class StorageClient {
  /** @param {StorageConfig & { label: string }} cfg */
  constructor(cfg) {
    this.cfg = cfg
    this.label = cfg.label
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region,
    })
  }

  /** Полный URL объекта в этом хранилище. */
  url(key) {
    const safeKey = key.split('/').map(encodeURIComponent).join('/')
    return `${this.cfg.endpoint}/${this.cfg.bucket}/${safeKey}`
  }

  /**
   * HEAD-запрос. Возвращает { exists, status, size, etag, contentType }.
   * При 404 → exists=false, exception только при сетевых сбоях.
   */
  async head(key) {
    const res = await this.#fetch('HEAD', this.url(key), undefined, undefined, HEAD_TIMEOUT_MS)
    if (res.status === 404) return { exists: false, status: 404 }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HEAD ${this.label} ${key}: ${res.status} ${text || res.statusText}`)
    }
    const size = Number(res.headers.get('content-length') ?? 0)
    return {
      exists: true,
      status: res.status,
      size: Number.isFinite(size) ? size : 0,
      etag: stripQuotes(res.headers.get('etag') ?? ''),
      contentType: res.headers.get('content-type') ?? '',
    }
  }

  /** GET → ArrayBuffer + метаданные. */
  async get(key) {
    const res = await this.#fetch('GET', this.url(key), undefined, undefined, GET_TIMEOUT_MS)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`GET ${this.label} ${key}: ${res.status} ${text || res.statusText}`)
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    return {
      body: buf,
      size: buf.byteLength,
      etag: stripQuotes(res.headers.get('etag') ?? ''),
      contentType: res.headers.get('content-type') ?? '',
    }
  }

  /**
   * PUT объект. body — Uint8Array/Buffer/Blob; задаём Content-Length явно
   * чтобы исключить chunked transfer (Cloud.ru/R2 на нём иногда чудят).
   */
  async put(key, body, contentType) {
    const len = body instanceof Uint8Array || body instanceof Buffer ? body.byteLength : undefined
    const headers = {}
    if (contentType) headers['content-type'] = contentType
    if (len != null) headers['content-length'] = String(len)
    const res = await this.#fetch('PUT', this.url(key), body, headers, PUT_TIMEOUT_MS)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PUT ${this.label} ${key}: ${res.status} ${text || res.statusText}`)
    }
    return {
      etag: stripQuotes(res.headers.get('etag') ?? ''),
    }
  }

  async delete(key) {
    const res = await this.#fetch('DELETE', this.url(key), undefined, undefined, DELETE_TIMEOUT_MS)
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new Error(`DELETE ${this.label} ${key}: ${res.status} ${text || res.statusText}`)
    }
  }

  /** Внутренняя обёртка с тайм-аутом и подписью SigV4 через aws4fetch. */
  async #fetch(method, url, body, headers, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // Uint8Array как body — буферизованное тело, fetch его обработает
      // без необходимости в duplex='half' (это нужно только для streamable
      // bodies). aws4fetch при подписи прочитает body чтобы посчитать
      // x-amz-content-sha256.
      const req = new Request(url, {
        method,
        body: body ?? null,
        headers,
        signal: controller.signal,
      })
      const signed = await this.client.sign(req)
      return await fetch(signed)
    } finally {
      clearTimeout(timer)
    }
  }
}

function stripQuotes(s) {
  if (!s) return ''
  return s.replace(/^"+|"+$/g, '')
}
