import { Card, Flex, Space, Typography } from 'antd'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { useAuth } from '@/app/providers/AuthProvider'
import { nav, settings } from '@/shared/i18n/ru'

export function SettingsPage() {
  const { profile, user } = useAuth()

  return (
    <>
      <PageHeader title={nav.settings} />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title={settings.themeLabel}>
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">
              Выберите светлую или тёмную тему, либо оставьте «{settings.themeSystem.toLowerCase()}».
            </Typography.Text>
            <ThemeToggle />
          </Flex>
        </Card>

        <Card title="Аккаунт">
          <Flex vertical gap={4}>
            <Typography.Text>
              <Typography.Text type="secondary">ФИО:&nbsp;</Typography.Text>
              {profile?.full_name ?? '—'}
            </Typography.Text>
            <Typography.Text>
              <Typography.Text type="secondary">Email:&nbsp;</Typography.Text>
              {user?.email ?? '—'}
            </Typography.Text>
            <Typography.Text>
              <Typography.Text type="secondary">Роль:&nbsp;</Typography.Text>
              {profile?.role === 'admin' ? 'Администратор' : 'Пользователь'}
            </Typography.Text>
          </Flex>
        </Card>

        <Card title={settings.storageLabel}>
          <Typography.Text type="secondary">{settings.storageSoon}</Typography.Text>
        </Card>
      </Space>
    </>
  )
}
