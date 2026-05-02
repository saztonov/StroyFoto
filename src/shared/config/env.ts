// Базовый URL backend API. Поддерживается:
//   - same-origin "/api" (production, reverse-proxy на тот же домен) — дефолт
//   - абсолютный "http://localhost:4000/api" (dev, vite и api на разных портах)
//   - VITE_API_URL без хвостового /api тоже допустимо (добавим автоматически).
const rawApiUrl = import.meta.env.VITE_API_URL ?? '/api'
const apiBaseUrl = rawApiUrl.replace(/\/$/, '')

// Все запросы фронта идут на собственный backend (Fastify). Подпись presigned
// URL к Cloud.ru S3 / Cloudflare R2 делает endpoint POST /api/storage/presign —
// секреты CLOUDRU_*/R2_* задаются на сервере и не покидают его.

export const env = {
  apiBaseUrl,
} as const
