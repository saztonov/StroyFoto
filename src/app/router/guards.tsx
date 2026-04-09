import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Flex, Spin } from 'antd'
import { useAuth } from '@/app/providers/AuthProvider'

function FullscreenSpinner() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', width: '100%' }}>
      <Spin size="large" />
    </Flex>
  )
}

/** Пускает дальше только неавторизованных. Авторизованных — сразу на /reports. */
export function RequireGuest() {
  const { loading, session } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (session) return <Navigate to="/reports" replace />
  return <Outlet />
}

interface RequireAuthProps {
  allowInactive?: boolean
}

/**
 * Требует авторизацию. По умолчанию неактивных отправляет на /pending-activation.
 * Пропусти `allowInactive`, чтобы разрешить неактивному пользователю увидеть экран ожидания.
 */
export function RequireAuth({ allowInactive = false }: RequireAuthProps) {
  const { loading, session, profile } = useAuth()
  const location = useLocation()

  if (loading) return <FullscreenSpinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  if (!allowInactive && profile && !profile.is_active) {
    return <Navigate to="/pending-activation" replace />
  }

  return <Outlet />
}

/** Доп. страховка: требует активный профиль. Используется в защищённом дереве layout'а. */
export function RequireActive() {
  const { profile, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (profile && !profile.is_active) return <Navigate to="/pending-activation" replace />
  return <Outlet />
}

/** Требует роль администратора. */
export function RequireAdmin() {
  const { profile, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!profile || profile.role !== 'admin') return <Navigate to="/reports" replace />
  return <Outlet />
}
