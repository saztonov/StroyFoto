import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { App } from 'antd'
import {
  applyAuthSession,
  loadProfile,
  mapAuthError,
  restoreSession,
  signOut as doSignOut,
} from '@/services/auth'
import type { SessionResponse } from '@/lib/apiClient'
import { getLastUserId, setLastUserId } from '@/services/deviceSettings'
import type { Profile } from '@/entities/profile/types'
import { setOnUnauthorized } from '@/lib/apiClient'
import { startSyncLoop, stopSyncLoop } from '@/services/sync'
import { applyRetention } from '@/services/retention'
import { startInvalidation, stopInvalidation } from '@/services/invalidation'
import { getCachedProfile, clearCachedProfile } from '@/services/profileCache'
import { countPendingReports } from '@/services/localReports'
import { wipeAllUserData, wipePendingUserData } from '@/services/logoutWipe'

export interface AuthSessionUser {
  id: string
  email: string
}

interface AuthContextValue {
  user: AuthSessionUser | null
  profile: Profile | null
  /** true пока не известно, авторизован ли пользователь, либо профиль ещё грузится. */
  loading: boolean
  /** Сообщение об ошибке загрузки профиля. null если профиль ок. */
  profileError: string | null
  /** @returns false, если пользователь отменил выход в диалоге подтверждения. */
  signOut: () => Promise<boolean>
  refreshProfile: () => Promise<void>
  /**
   * Принимает сессию на этом устройстве: при необходимости дожидается очистки
   * данных прежнего владельца и только потом запускает синхронизацию.
   * Используется логином, регистрацией и сбросом пароля.
   */
  adoptSession: (
    data: SessionResponse,
    options: { persistent: boolean },
  ) => Promise<AuthResult>
  /** Кому принадлежат локальные данные на устройстве (переживает разлогин). */
  resolveLocalDataOwner: () => Promise<string | null>
}

export interface AuthResult {
  user: AuthSessionUser
  profile: Profile
}

const AuthContext = createContext<AuthContextValue | null>(null)

function pluralizeReports(n: number): string {
  const last2 = n % 100
  if (last2 >= 11 && last2 <= 14) return 'отчётов'
  const last = n % 10
  if (last === 1) return 'отчёт'
  if (last >= 2 && last <= 4) return 'отчёта'
  return 'отчётов'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { modal } = App.useApp()
  const [user, setUser] = useState<AuthSessionUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const mounted = useRef(true)
  const loadedForUserId = useRef<string | null>(null)
  // Какой userId был залогинен при предыдущем старте — нужен для обнаружения
  // смены пользователя на одном устройстве (cross-user wipe).
  const previousUserId = useRef<string | null>(null)

  const teardown = useCallback(async () => {
    setUser(null)
    setProfile(null)
    loadedForUserId.current = null
    setProfileError(null)
    stopSyncLoop()
    stopInvalidation()
    void clearCachedProfile()
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileLoading(true)
    setProfileError(null)
    loadedForUserId.current = userId
    try {
      const p = await loadProfile(userId)
      if (!mounted.current) return
      if (loadedForUserId.current !== userId) return
      setProfile(p)
    } catch (e) {
      if (!mounted.current) return
      if (loadedForUserId.current !== userId) return
      try {
        const cached = await getCachedProfile()
        if (cached && cached.id === userId) {
          setProfile(cached)
          return
        }
      } catch {
        // IDB недоступна — fallthrough
      }
      setProfile(null)
      loadedForUserId.current = null
      setProfileError(mapAuthError(e))
    } finally {
      if (mounted.current && loadedForUserId.current === userId) {
        setProfileLoading(false)
      }
    }
  }, [])

  /**
   * Кому принадлежат локальные данные устройства.
   *
   * Полагаться на `user === null` нельзя: teardown() после 401 обнуляет
   * состояние, но НЕ previousUserId, а после перезагрузки страницы пуст и он —
   * при том что отчёты и фото прежнего пользователя лежат в IDB. Поэтому
   * владелец дублируется в device_settings и переживает и разлогин, и
   * перезагрузку.
   */
  const resolveLocalDataOwner = useCallback(async (): Promise<string | null> => {
    if (previousUserId.current) return previousUserId.current
    return getLastUserId()
  }, [])

  /**
   * Общий хвост принятия сессии: очистка чужих данных, фиксация владельца,
   * состояние и только потом — запуск фоновых циклов.
   */
  const adoptResolvedSession = useCallback(
    async (nextUser: AuthSessionUser, nextProfile: Profile): Promise<AuthResult> => {
      const owner = previousUserId.current ?? (await getLastUserId())

      if (owner && owner !== nextUser.id) {
        // ДОЖИДАЕМСЯ очистки. Раньше здесь стоял `void wipeAllUserData()`, и
        // синхронизация нового пользователя стартовала параллельно с удалением
        // данных прежнего — а wipe сносит в том числе несинхронизированные
        // отчёты и фото.
        try {
          await wipeAllUserData()
        } catch (e) {
          console.warn('wipeAllUserData on user switch failed:', e)
        }
      }

      try {
        await setLastUserId(nextUser.id)
      } catch (e) {
        console.warn('setLastUserId failed:', e)
      }

      previousUserId.current = nextUser.id
      setUser(nextUser)
      setProfile(nextProfile)
      loadedForUserId.current = nextUser.id
      setProfileError(null)

      startSyncLoop()
      startInvalidation(nextUser.id)
      void applyRetention()

      return { user: nextUser, profile: nextProfile }
    },
    [],
  )

  const adoptSession = useCallback(
    async (
      data: SessionResponse,
      options: { persistent: boolean },
    ): Promise<AuthResult> => {
      const applied = await applyAuthSession(data, options)
      return adoptResolvedSession(applied.user, applied.profile)
    },
    [adoptResolvedSession],
  )

  const handleSignOut = useCallback(async (): Promise<boolean> => {
    // Если в очереди есть pending — не сжигаем их молча. Спросим юзера:
    // выйти и потерять, или остаться и подождать sync. Без этого был
    // путь потери данных (выход → следующий вход чужого юзера → отправка
    // pending под чужой сессией).
    let pending = 0
    try {
      pending = await countPendingReports()
    } catch {
      // если IDB недоступна — пропускаем подтверждение, всё равно logout
    }
    if (pending > 0) {
      const proceed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: 'Есть несинхронизированные данные',
          content: `На устройстве осталось ${pending} ${pluralizeReports(pending)} без синхронизации с сервером. Если выйти сейчас, они будут потеряны.`,
          okText: 'Выйти и потерять',
          okButtonProps: { danger: true },
          cancelText: 'Остаться',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      // Отмену возвращаем наверх: UI сброса пароля должен отличать «вышел»
      // от «передумал», иначе покажет неверный экран.
      if (!proceed) return false
    }
    try {
      await doSignOut()
    } finally {
      try { await wipePendingUserData() } catch (e) {
        console.warn('wipePendingUserData on signOut failed:', e)
      }
      await teardown()
    }
    return true
  }, [modal, teardown])

  // На любой 401 от любого fetch — выкидываем пользователя.
  useEffect(() => {
    setOnUnauthorized(() => {
      void teardown()
    })
    return () => setOnUnauthorized(() => {})
  }, [teardown])

  // Старт: пробуем восстановить сессию из refresh-токена.
  useEffect(() => {
    mounted.current = true
    let cancelled = false

    void (async () => {
      try {
        const restored = await restoreSession()
        if (cancelled || !mounted.current) return
        if (restored) {
          // Тот же путь, что и у логина: очистка чужих данных дожидается
          // завершения до старта синхронизации, владелец фиксируется в IDB.
          await adoptResolvedSession(restored.user, restored.profile)
        }
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()

    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [adoptResolvedSession])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    loadedForUserId.current = null
    await fetchProfile(user.id)
  }, [user, fetchProfile])

  // При возвращении сети — обновляем профиль с сервера.
  useEffect(() => {
    const handleOnline = () => {
      if (user) void refreshProfile()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [user, refreshProfile])

  const loading = sessionLoading || profileLoading

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      profileError,
      signOut: handleSignOut,
      refreshProfile,
      adoptSession,
      resolveLocalDataOwner,
    }),
    [
      user,
      profile,
      loading,
      profileError,
      handleSignOut,
      refreshProfile,
      adoptSession,
      resolveLocalDataOwner,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
