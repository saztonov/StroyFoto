import { supabase } from "../lib/supabase";

/**
 * Get a valid access token from Supabase Auth.
 * Supabase client handles refresh automatically.
 */
export async function getValidToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Handle a 401 auth error by refreshing the Supabase session.
 * Returns new access token on success, or null if refresh fails.
 */
export async function handleAuthError(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.refreshSession();
  if (error || !session) {
    return null;
  }
  return session.access_token;
}
