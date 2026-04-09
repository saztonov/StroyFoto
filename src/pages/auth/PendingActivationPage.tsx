import { useState } from 'react'
import { App, Button, Card, Flex, Result, Typography } from 'antd'
import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '@/app/providers/AuthProvider'
import { mapAuthError } from '@/services/auth'
import { actions, auth } from '@/shared/i18n/ru'

export function PendingActivationPage() {
  const { signOut, refreshProfile, profile } = useAuth()
  const { message } = App.useApp()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshProfile()
      message.success(auth.statusUpdated)
    } catch (e) {
      message.error(mapAuthError(e))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Card>
      <Result
        status="info"
        title={auth.pendingTitle}
        subTitle={auth.pendingText}
        extra={
          <Flex vertical gap={12} align="center">
            <Typography.Text type="secondary">{auth.pendingHint}</Typography.Text>
            {profile?.full_name ? (
              <Typography.Text strong>{profile.full_name}</Typography.Text>
            ) : null}
            <Flex gap={8} wrap>
              <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleRefresh()}>
                Обновить статус
              </Button>
              <Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
                {actions.signOut}
              </Button>
            </Flex>
          </Flex>
        }
      />
    </Card>
  )
}
