import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Button, Flex, Result, Spin } from 'antd'
import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '@/app/providers/AuthProvider'
import { actions, errors as errStrings } from '@/shared/i18n/ru'

function FullscreenSpinner() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', width: '100%' }}>
      <Spin size="large" />
    </Flex>
  )
}

function ProfileErrorScreen({ message }: { message: string }) {
  const { refreshProfile, signOut } = useAuth()
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', width: '100%', padding: 16 }}>
      <Result
        status="warning"
        title={errStrings.profileLoadFailed}
        subTitle={message}
        extra={
          <Flex gap={8} justify="center" wrap>
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => void refreshProfile()}>
              Повторить
            </Button>
            <Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
              {actions.signOut}
            </Button>
          </Flex>
        }
      />
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
  const { loading, session, profile, profileError } = useAuth()
  const location = useLocation()

  if (loading) return <FullscreenSpinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  // Профиль не загрузился — показываем экран ошибки вместо случайного редиректа.
  if (profileError) return <ProfileErrorScreen message={profileError} />

  // Страховка от рассинхрона: сессия есть, профиля ещё нет — ждём.
  if (!profile) return <FullscreenSpinner />

  if (!allowInactive && !profile.is_active) {
    return <Navigate to="/pending-activation" replace />
  }

  return <Outlet />
}

/** Доп. страховка: требует активный профиль. Используется в защищённом дереве layout'а. */
export function RequireActive() {
  const { profile, loading, profileError } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (profileError) return <ProfileErrorScreen message={profileError} />
  if (!profile) return <FullscreenSpinner />
  if (!profile.is_active) return <Navigate to="/pending-activation" replace />
  return <Outlet />
}

/** Требует роль администратора. */
export function RequireAdmin() {
  const { profile, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!profile || profile.role !== 'admin') return <Navigate to="/reports" replace />
  return <Outlet />
}
