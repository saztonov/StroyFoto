import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db, type AuthSession } from "../db/dexie";
import type { LoginResponse } from "@stroyfoto/shared";

interface AuthContextValue {
  user: AuthSession | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_SESSION_KEY = "current";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.authSession
      .get(AUTH_SESSION_KEY)
      .then((session) => {
        if (session && session.expiresAt > Date.now()) {
          setUser(session);
        } else if (session) {
          db.authSession.delete(AUTH_SESSION_KEY);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? "Ошибка авторизации");
    }

    const data: LoginResponse = await res.json();

    const now = Date.now();
    const session: AuthSession = {
      id: AUTH_SESSION_KEY,
      token: data.accessToken ?? data.token,
      refreshToken: data.refreshToken ?? "",
      userId: data.user.id,
      username: data.user.username,
      role: data.user.role,
      fullName: data.user.fullName,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      tokenIssuedAt: now,
    };

    await db.authSession.put(session);
    setUser(session);
  }, []);

  const logout = useCallback(async () => {
    await db.authSession.delete(AUTH_SESSION_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token: user?.token ?? null,
        isAuthenticated: user !== null,
        loading,
        login,
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
