import { createClient } from '@supabase/supabase-js'
import { env } from '@/shared/config/env'

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'stroyfoto:auth',
  },
})
