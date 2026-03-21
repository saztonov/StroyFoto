import { db } from "../db/dexie";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

// Access token lifetime is 15m by default; refresh proactively when < 2 min remain
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
// Default access token lifetime (15m) — used when tokenIssuedAt is available
const DEFAULT_ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token on success, or null if refresh fails (session expired).
 */
export async function refreshAccessToken(): Promise<string | null> {
  const session = await db.authSession.get("current");
  if (!session?.refreshToken) return null;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      // Refresh token is invalid/expired — clear session
      await db.authSession.delete("current");
      return null;
    }

    const data = await res.json();
    const now = Date.now();

    await db.authSession.update("current", {
      token: data.accessToken,
      refreshToken: data.refreshToken,
      tokenIssuedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    return data.accessToken;
  } catch {
    // Network error — don't clear session, just return null
    return null;
  }
}

/**
 * Get a valid access token, proactively refreshing if near expiry.
 * Deduplicates concurrent refresh calls.
 */
export async function getValidToken(): Promise<string | null> {
  const session = await db.authSession.get("current");
  if (!session?.token) return null;

  // Check if token is near expiry (if we know when it was issued)
  if (session.tokenIssuedAt) {
    const elapsed = Date.now() - session.tokenIssuedAt;
    const remaining = DEFAULT_ACCESS_TOKEN_LIFETIME_MS - elapsed;

    if (remaining < TOKEN_REFRESH_MARGIN_MS && session.refreshToken) {
      // Deduplicate concurrent refresh calls
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      return newToken ?? session.token;
    }
  }

  return session.token;
}

/**
 * Handle a 401 auth error by attempting token refresh.
 * Returns new access token on success, or null if refresh fails.
 * Deduplicates concurrent calls.
 */
export async function handleAuthError(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
