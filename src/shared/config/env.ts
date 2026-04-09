const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const presignUrl = import.meta.env.VITE_PRESIGN_URL

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните их.',
  )
}

if (!presignUrl) {
  throw new Error(
    'Не задана переменная окружения VITE_PRESIGN_URL — это URL доверенного ' +
      'Cloudflare Worker для выдачи presigned URL к R2. См. .env.example и worker/README.md.',
  )
}

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  presignUrl: presignUrl.replace(/\/+$/, ''),
} as const
