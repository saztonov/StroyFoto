import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { loadProfile, signOut as doSignOut } from '@/services/auth'
import type { Profile } from '@/entities/profile/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)
    if (!nextSession) {
      setProfile(null)
      return
    }
    const p = await loadProfile(nextSession.user.id)
    if (mounted.current) setProfile(p)
  }, [])

  useEffect(() => {
    mounted.current = true
    let cancelled = false

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        await applySession(data.session ?? null)
      } finally {
        if (!cancelled) setLoading(false)
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
    const p = await loadProfile(session.user.id)
    if (mounted.current) setProfile(p)
  }, [session])

  const handleSignOut = useCallback(async () => {
    await doSignOut()
    setSession(null)
    setProfile(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signOut: handleSignOut,
      refreshProfile,
    }),
    [session, profile, loading, handleSignOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
