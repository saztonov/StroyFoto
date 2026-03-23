import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { db, type AuthSession } from "../db/dexie";
import { cleanScopedCacheOnLogin } from "../db/scope-migration";
import type { Session } from "@supabase/supabase-js";

interface AuthContextValue {
  user: AuthSession | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_SESSION_KEY = "current";

let profileFetchPromise: Promise<AuthSession | null> | null = null;
let authFailed = false;

/** Deduplicated wrapper — prevents concurrent fetches from init() and onAuthStateChange */
function fetchAndCacheProfileDeduped(accessToken: string, session: Session): Promise<AuthSession | null> {
  if (authFailed) return Promise.resolve(null);
  if (profileFetchPromise) return profileFetchPromise;
  profileFetchPromise = fetchAndCacheProfile(accessToken, session).finally(() => {
    profileFetchPromise = null;
  });
  return profileFetchPromise;
}

/** Helper to build AuthSession from API profile response */
function buildAuthSession(profile: Record<string, unknown>, session: Session): AuthSession {
  return {
    id: AUTH_SESSION_KEY,
    userId: profile.id as string,
    email: (profile.email as string) ?? session.user.email ?? "",
    role: (profile.role as "ADMIN" | "WORKER") ?? "WORKER",
    fullName: (profile.fullName as string) ?? "",
  };
}

/** Fetch profile from our API and save to Dexie for offline access */
async function fetchAndCacheProfile(accessToken: string, session: Session): Promise<AuthSession | null> {
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const res = await fetch(`${apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.ok) {
    authFailed = false;
    const authSession = buildAuthSession(await res.json(), session);
    await db.authSession.put(authSession);
    return authSession;
  }

  // Account disabled — terminal state
  if (res.status === 403) {
    await supabase.auth.signOut().catch(() => {});
    await db.authSession.delete(AUTH_SESSION_KEY);
    return null;
  }

  // Unauthorized — try refreshing the session once
  if (res.status === 401) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    if (refreshed) {
      const retry = await fetch(`${apiUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${refreshed.access_token}` },
      });
      if (retry.ok) {
        authFailed = false;
        const authSession = buildAuthSession(await retry.json(), refreshed);
        await db.authSession.put(authSession);
        return authSession;
      }
    }
    // Refresh failed or retry still 401 — session is dead
    authFailed = true;
    await supabase.auth.signOut().catch(() => {});
    await db.authSession.delete(AUTH_SESSION_KEY);
    return null;
  }

  // Other errors (5xx, network issues) — fallback to Supabase session data for offline
  const authSession: AuthSession = {
    id: AUTH_SESSION_KEY,
    userId: session.user.id,
    email: session.user.email ?? "",
    role: (session.user.app_metadata?.app_role as "ADMIN" | "WORKER") ?? "WORKER",
    fullName: (session.user.user_metadata?.full_name as string) ?? "",
  };
  await db.authSession.put(authSession);
  return authSession;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session
    async function init() {
      // First check Dexie for offline-cached profile
      const cached = await db.authSession.get(AUTH_SESSION_KEY);

      // Check Supabase session
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        try {
          const profile = await fetchAndCacheProfileDeduped(session.access_token, session);
          if (profile) {
            setUser(profile);
            // Clean synced data from other users and reset reference data for current scope
            cleanScopedCacheOnLogin(profile.userId).catch(() => {});
          } else {
            // Account disabled — profile returned null
            setUser(null);
          }
        } catch {
          // Offline — use cached profile
          if (cached) {
            setUser(cached);
          }
        }
      } else if (cached) {
        // No Supabase session but have cached profile — clear it
        await db.authSession.delete(AUTH_SESSION_KEY);
        setUser(null);
      }

      setLoading(false);
    }

    init();

    // Listen for auth state changes (e.g., token refresh, sign out from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        await db.authSession.delete(AUTH_SESSION_KEY);
        setUser(null);
      } else if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        try {
          const profile = await fetchAndCacheProfileDeduped(session.access_token, session);
          setUser(profile);
        } catch {
          // Ignore fetch errors during token refresh
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const refreshUser = useCallback(async () => {
    const cached = await db.authSession.get(AUTH_SESSION_KEY);
    if (cached) setUser(cached);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
      authFailed = false;
      const profile = await fetchAndCacheProfile(data.session.access_token, data.session);
      if (!profile) {
        throw new Error("Аккаунт заблокирован");
      }
      setUser(profile);
    }
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
      authFailed = false;
      const profile = await fetchAndCacheProfile(data.session.access_token, data.session);
      if (!profile) {
        throw new Error("Аккаунт заблокирован");
      }
      setUser(profile);
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    await db.authSession.delete(AUTH_SESSION_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token: null, // Token is managed by Supabase client, use supabase.auth.getSession()
        isAuthenticated: user !== null,
        loading,
        refreshUser,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
