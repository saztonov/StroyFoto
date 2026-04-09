const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните их.',
  )
}

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  presignUrl: import.meta.env.VITE_PRESIGN_URL,
} as const
