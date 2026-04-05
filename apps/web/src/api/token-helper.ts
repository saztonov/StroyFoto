import { supabase } from "../lib/supabase";

/**
 * Get a valid access token from Supabase Auth.
 * Proactively refreshes if the token expires within 30 seconds.
 * Falls back to the expired token if refresh fails — individual sync
 * operations handle 401 with their own retry logic.
 */
export async function getValidToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    try {
      const payload = JSON.parse(atob(session.access_token.split('.')[1]));
      if (payload.exp * 1000 < Date.now() + 30_000) {
        const { data: { session: refreshed } } = await supabase.auth.refreshSession();
        if (refreshed?.access_token) return refreshed.access_token;
        // Refresh failed — return expired token as fallback;
        // sync operations have their own 401 handling with retry
        console.warn("[token] Refresh failed, using expired token as fallback");
        return session.access_token;
      }
    } catch {
      // If JWT decode fails, use token as-is (server will 401 if invalid)
    }

    return session.access_token;
  } catch (err) {
    console.error("[token] getValidToken error:", err);
    return null;
  }
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
