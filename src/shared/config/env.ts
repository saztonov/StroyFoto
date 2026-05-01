const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Не заданы переменные окружения VITE_SUPABASE_URL и/или VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните их.',
  )
}

// Подпись presigned URL к Cloud.ru Object Storage (s3.cloud.ru) делает
// Supabase Edge Function `sign` (см. supabase/functions/sign/). URL функции
// собирается из VITE_SUPABASE_URL внутри supabase.functions.invoke —
// отдельной переменной не требуется. Все секреты Cloud.ru S3 (CLOUDRU_*)
// и легаси-секреты R2 (R2_*, нужны только для миграции исторических
// объектов) задаются через `supabase secrets set` и хранятся в Supabase.

export const env = {
  supabaseUrl,
  supabaseAnonKey,
} as const
