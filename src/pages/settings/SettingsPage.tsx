import { useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Flex, Radio, Space, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { useAuth } from '@/app/providers/AuthProvider'
import { nav, settings } from '@/shared/i18n/ru'
import type { RetentionMode } from '@/lib/db'
import { getRetention, setRetention } from '@/services/deviceSettings'
import { applyRetention } from '@/services/retention'

export function SettingsPage() {
  const { profile, user } = useAuth()
  const [mode, setMode] = useState<RetentionMode>('all')
  const [fromDate, setFromDate] = useState<Dayjs | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getRetention().then((r) => {
      setMode(r.mode)
      if (r.fromDate) setFromDate(dayjs(r.fromDate))
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const value =
        mode === 'from_date' && fromDate
          ? { mode, fromDate: fromDate.format('YYYY-MM-DD') }
          : { mode }
      await setRetention(value)
      const { removed } = await applyRetention()
      message.success(
        removed > 0
          ? `Настройки сохранены. Удалено синхронизированных отчётов: ${removed}.`
          : 'Настройки сохранены.',
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось сохранить настройки')
    } finally {
      setSaving(false)
    }
  }

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
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">
              Управляет тем, какие синхронизированные отчёты остаются на этом устройстве.
            </Typography.Text>
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value as RetentionMode)}
            >
              <Space direction="vertical">
                <Radio value="all">Хранить всю историю на устройстве</Radio>
                <Radio value="from_date">Хранить только с выбранной даты</Radio>
                <Radio value="none">Не хранить историю локально (открывать только онлайн)</Radio>
              </Space>
            </Radio.Group>
            {mode === 'from_date' && (
              <DatePicker
                value={fromDate}
                onChange={setFromDate}
                format="DD.MM.YYYY"
                placeholder="Дата начала хранения"
              />
            )}
            <Alert
              type="info"
              showIcon
              message="Несинхронизированные отчёты и фото никогда не удаляются — они останутся локально, пока не будут отправлены на сервер."
            />
            <Button
              type="primary"
              onClick={handleSave}
              loading={saving}
              disabled={mode === 'from_date' && !fromDate}
              style={{ alignSelf: 'flex-start' }}
            >
              Сохранить
            </Button>
          </Flex>
        </Card>
      </Space>
    </>
  )
}
