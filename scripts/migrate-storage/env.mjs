// Загрузчик окружения для CLI миграции. Читает .env.migrate из cwd
// (или путь из --config=...), проверяет наличие обязательных ключей.
//
// Никаких внешних зависимостей: парсер строк KEY=VALUE с поддержкой
// комментариев (#) и кавычек.
//
// ПОЧЕМУ отдельный файл, а не корневой .env:
// - В .env лежат VITE_* (публичные anon-ключи). Здесь нужны service_role
//   и секреты обоих хранилищ — это разные уровни доверия.
// - Ошибочный коммит .env.migrate с service_role был бы катастрофой,
//   поэтому файл отдельный и явно в .gitignore.

import fs from 'node:fs'
import path from 'node:path'

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'CLOUDRU_TENANT_ID',
  'CLOUDRU_KEY_ID',
  'CLOUDRU_KEY_SECRET',
  'CLOUDRU_BUCKET',
]

const OPTIONAL_DEFAULTS = {
  CLOUDRU_ENDPOINT: 'https://s3.cloud.ru',
  CLOUDRU_REGION: 'ru-central-1',
  R2_ENDPOINT: '', // Если задано — используется как полный endpoint вместо <ACCOUNT_ID>.r2.cloudflarestorage.com
}

function parseDotEnv(content) {
  const out = {}
  const lines = content.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

/**
 * @param {{ config?: string }} [opts]
 * @returns {{
 *   supabase: { url: string, serviceRoleKey: string },
 *   r2: { endpoint: string, region: 'auto', accessKeyId: string, secretAccessKey: string, bucket: string },
 *   cloudru: { endpoint: string, region: string, accessKeyId: string, secretAccessKey: string, bucket: string },
 * }}
 */
export function loadEnv(opts = {}) {
  const envFile = opts.config
    ? path.resolve(opts.config)
    : path.resolve(process.cwd(), '.env.migrate')

  if (!fs.existsSync(envFile)) {
    throw new Error(
      `Файл ${envFile} не найден.\n` +
        'Скопируйте scripts/migrate-storage/.env.migrate.example в .env.migrate ' +
        'и заполните своими значениями (или укажите путь через --config=...).',
    )
  }

  const fileEnv = parseDotEnv(fs.readFileSync(envFile, 'utf8'))
  const merged = { ...fileEnv, ...process.env } // process.env приоритетнее (CI/перезапуск)
  const env = { ...merged }

  // Defaults для опциональных полей
  for (const [k, v] of Object.entries(OPTIONAL_DEFAULTS)) {
    if (!env[k]) env[k] = v
  }

  const missing = REQUIRED.filter((k) => !env[k] || env[k].length === 0)
  if (missing.length) {
    throw new Error(
      `В ${envFile} (или process.env) не заданы обязательные переменные:\n  - ${missing.join('\n  - ')}`,
    )
  }

  // Cloud.ru access key — composite: <tenant_id>:<key_id>
  const cloudruAccessKey = `${env.CLOUDRU_TENANT_ID}:${env.CLOUDRU_KEY_ID}`

  const r2Endpoint = env.R2_ENDPOINT && env.R2_ENDPOINT.length > 0
    ? env.R2_ENDPOINT.replace(/\/$/, '')
    : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  return {
    supabase: {
      url: env.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    r2: {
      endpoint: r2Endpoint,
      region: 'auto',
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    },
    cloudru: {
      endpoint: env.CLOUDRU_ENDPOINT.replace(/\/$/, ''),
      region: env.CLOUDRU_REGION,
      accessKeyId: cloudruAccessKey,
      secretAccessKey: env.CLOUDRU_KEY_SECRET,
      bucket: env.CLOUDRU_BUCKET,
    },
  }
}
