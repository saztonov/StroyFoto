const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните их.',
  )
}

// Подпись presigned URL к Cloudflare R2 делает Supabase Edge Function `sign`
// (см. supabase/functions/sign/). URL функции собирается из VITE_SUPABASE_URL
// внутри supabase.functions.invoke — отдельной переменной не требуется.

export const env = {
  supabaseUrl,
  supabaseAnonKey,
} as const
