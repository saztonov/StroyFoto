const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const presignUrlRaw = import.meta.env.VITE_PRESIGN_URL
const isProd = import.meta.env.PROD

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните их.',
  )
}

// VITE_PRESIGN_URL: в проде — обязательна, иначе R2-путь (фото, PDF-планы) не
// работает и приложение ломается на любой загрузке. В dev — допустимо не задавать,
// UI покажет неактивный PlanMarkPicker и заблокирует загрузку фото.
if (isProd && !presignUrlRaw) {
  throw new Error(
    'В production-сборке обязательна переменная VITE_PRESIGN_URL — URL доверенного ' +
      'Cloudflare Worker для выдачи presigned URL к R2. См. worker/README.md.',
  )
}

if (!presignUrlRaw && !isProd) {
  // eslint-disable-next-line no-console
  console.warn(
    '[env] VITE_PRESIGN_URL не задана. В dev-режиме это допустимо, но загрузка фото ' +
      'и работа с PDF-планами будут недоступны до подключения Cloudflare Worker.',
  )
}

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  presignUrl: (presignUrlRaw ?? '').replace(/\/+$/, ''),
} as const
