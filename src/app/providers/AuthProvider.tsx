import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { loadProfile, mapAuthError, signOut as doSignOut } from '@/services/auth'
import type { Profile } from '@/entities/profile/types'
import { startSyncLoop, stopSyncLoop } from '@/services/sync'
import { applyRetention } from '@/services/retention'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  /** true пока не известно, авторизован ли пользователь, либо профиль ещё грузится. */
  loading: boolean
  /** Сообщение об ошибке загрузки профиля (сеть/RLS). null если профиль ок. */
  profileError: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const mounted = useRef(true)
  // Запоминаем id пользователя, для которого уже загружен профиль, чтобы
  // не дублировать запрос при INITIAL_SESSION после getSession().
  const loadedForUserId = useRef<string | null>(null)

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileLoading(true)
    setProfileError(null)
    // Резервируем слот до await'а, чтобы параллельные вызовы могли увидеть,
    // что профиль уже запрашивается именно для этого userId.
    loadedForUserId.current = userId
    try {
      const p = await loadProfile(userId)
      if (!mounted.current) return
      // За время await сессия могла смениться (другой user залогинился
      // или произошёл logout). В этом случае молча игнорируем результат.
      if (loadedForUserId.current !== userId) return
      setProfile(p)
    } catch (e) {
      if (!mounted.current) return
      if (loadedForUserId.current !== userId) return
      setProfile(null)
      loadedForUserId.current = null
      setProfileError(mapAuthError(e))
    } finally {
      if (mounted.current && loadedForUserId.current === userId) {
        setProfileLoading(false)
      }
    }
  }, [])

  const applySession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession)

      if (!nextSession) {
        setProfile(null)
        loadedForUserId.current = null
        setProfileError(null)
        stopSyncLoop()
        return
      }

      // Дедупликация: если профиль уже загружен для этого user.id — ничего не делаем.
      if (loadedForUserId.current === nextSession.user.id) {
        startSyncLoop()
        void applyRetention()
        return
      }

      await fetchProfile(nextSession.user.id)
      startSyncLoop()
      void applyRetention()
    },
    [fetchProfile],
  )

  useEffect(() => {
    mounted.current = true
    let cancelled = false

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        await applySession(data.session ?? null)
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession)
    })

    return () => {
      cancelled = true
      mounted.current = false
      sub.subscription.unsubscribe()
    }
  }, [applySession])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    // Принудительно сбрасываем кэш дедупликации, чтобы повторный запрос ушёл.
    loadedForUserId.current = null
    await fetchProfile(session.user.id)
  }, [session, fetchProfile])

  const handleSignOut = useCallback(async () => {
    // onAuthStateChange сам обнулит session/profile.
    await doSignOut()
  }, [])

  const loading = sessionLoading || profileLoading

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileError,
      signOut: handleSignOut,
      refreshProfile,
    }),
    [session, profile, loading, profileError, handleSignOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
