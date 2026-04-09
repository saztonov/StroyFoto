import { Button, Card, Flex, Result, Typography } from 'antd'
import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuth } from '@/app/providers/AuthProvider'
import { actions, auth } from '@/shared/i18n/ru'

export function PendingActivationPage() {
  const { signOut, refreshProfile, profile } = useAuth()

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
              <Button icon={<ReloadOutlined />} onClick={() => void refreshProfile()}>
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
