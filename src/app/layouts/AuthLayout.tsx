import { Outlet } from 'react-router-dom'
import { Flex, Typography } from 'antd'
import { appName } from '@/shared/i18n/ru'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'

export function AuthLayout() {
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      style={{
        minHeight: '100dvh',
        padding: 16,
        background: 'var(--stroyfoto-auth-bg, transparent)',
      }}
    >
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <ThemeToggle compact />
      </div>

      <Flex vertical align="center" gap={8} style={{ marginBottom: 24 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          {appName}
        </Typography.Title>
        <Typography.Text type="secondary">Фотоконтроль строительства</Typography.Text>
      </Flex>

      <div style={{ width: '100%', maxWidth: 420 }}>
        <Outlet />
      </div>
    </Flex>
  )
}
