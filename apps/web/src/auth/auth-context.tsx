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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_SESSION_KEY = "current";

let profileFetchPromise: Promise<AuthSession | null> | null = null;

/** Deduplicated wrapper — prevents concurrent fetches from init() and onAuthStateChange */
function fetchAndCacheProfileDeduped(accessToken: string, session: Session): Promise<AuthSession | null> {
  if (profileFetchPromise) return profileFetchPromise;
  profileFetchPromise = fetchAndCacheProfile(accessToken, session).finally(() => {
    profileFetchPromise = null;
  });
  return profileFetchPromise;
}

/** Fetch profile from our API and save to Dexie for offline access */
async function fetchAndCacheProfile(accessToken: string, session: Session): Promise<AuthSession | null> {
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const res = await fetch(`${apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.ok) {
    const profile = await res.json();
    const authSession: AuthSession = {
      id: AUTH_SESSION_KEY,
      userId: profile.id,
      email: profile.email ?? session.user.email ?? "",
      role: profile.role ?? "WORKER",
      fullName: profile.fullName ?? "",
    };
    await db.authSession.put(authSession);
    return authSession;
  }

  // Account disabled — terminal state, clear session and don't fallback
  if (res.status === 403) {
    await supabase.auth.signOut().catch(() => {});
    await db.authSession.delete(AUTH_SESSION_KEY);
    return null;
  }

  // Fallback: use Supabase session data
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

  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
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
