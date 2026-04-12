import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, DatePicker, Flex, Progress, Radio, Space, Typography } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { useAuth } from '@/app/providers/AuthProvider'
import { nav, settings } from '@/shared/i18n/ru'
import type { RetentionMode } from '@/lib/db'
import { getRetention, setRetention } from '@/services/deviceSettings'
import { applyRetention } from '@/services/retention'
import { usePwaInstall } from '@/shared/hooks/usePwaInstall'
import { fullSync, type FullSyncProgress } from '@/services/fullSync'

export function SettingsPage() {
  const { message, modal } = App.useApp()
  const { profile, user } = useAuth()
  const { canInstall, isInstalled, install } = usePwaInstall()
  const [mode, setMode] = useState<RetentionMode>('all')
  const [fromDate, setFromDate] = useState<Dayjs | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<FullSyncProgress | null>(null)

  async function handleFullSync() {
    setSyncing(true)
    setSyncProgress(null)
    try {
      const result = await fullSync((p) => setSyncProgress(p))
      message.success(
        `${settings.syncDone}. Планов загружено: ${result.plansDownloaded}, отчётов обновлено: ${result.reportsCached}.`,
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : settings.syncError)
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  useEffect(() => {
    void getRetention().then((r) => {
      setMode(r.mode)
      if (r.fromDate) setFromDate(dayjs(r.fromDate))
    })
  }, [])

  function handleResetLocalDb() {
    modal.confirm({
      title: 'Сбросить локальную базу данных?',
      content:
        'Будут удалены ВСЕ локальные данные, включая несинхронизированные отчёты и фото. ' +
        'Восстановить их будет невозможно. Используйте эту операцию, только если приложение сообщает о повреждении локальной базы.',
      okText: 'Удалить и перезагрузить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = indexedDB.deleteDatabase('stroyfoto')
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
            req.onblocked = () => reject(new Error('Удаление заблокировано — закройте другие вкладки приложения.'))
          })
          location.reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : 'Не удалось сбросить локальную базу')
        }
      },
    })
  }

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

        <Card title="Приложение">
          <Flex vertical gap={12}>
            {isInstalled ? (
              <Typography.Text type="secondary">
                Приложение уже установлено на это устройство.
              </Typography.Text>
            ) : canInstall ? (
              <>
                <Typography.Text type="secondary">
                  Установите СтройФото как приложение для быстрого доступа и работы офлайн.
                </Typography.Text>
                <Button type="primary" onClick={install} style={{ alignSelf: 'flex-start' }}>
                  Установить приложение
                </Button>
              </>
            ) : (
              <Typography.Text type="secondary">
                Чтобы установить приложение, откройте меню браузера и выберите «Добавить на главный
                экран» (iOS&nbsp;Safari) или «Установить приложение» (Chrome&nbsp;/&nbsp;Edge).
              </Typography.Text>
            )}
          </Flex>
        </Card>

        <Card title={settings.syncLabel}>
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">
              {settings.syncAllDesc}
            </Typography.Text>
            {syncProgress && syncProgress.total > 0 && (
              <Flex vertical gap={4}>
                <Typography.Text>
                  {syncProgress.phaseLabel}: {syncProgress.current} / {syncProgress.total}
                </Typography.Text>
                <Progress
                  percent={Math.round((syncProgress.current / syncProgress.total) * 100)}
                  size="small"
                  showInfo={false}
                />
              </Flex>
            )}
            {syncProgress && syncProgress.total === 0 && (
              <Typography.Text type="secondary">{syncProgress.phaseLabel}...</Typography.Text>
            )}
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              onClick={handleFullSync}
              loading={syncing}
              style={{ alignSelf: 'flex-start' }}
            >
              {settings.syncAllBtn}
            </Button>
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
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {settings.storageRetentionHint}
            </Typography.Text>
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

        <Card title="Обслуживание">
          <Flex vertical gap={12}>
            <Typography.Text type="secondary">
              Если приложение сообщает о повреждении локальной базы данных и не даёт создавать отчёты,
              выполните сброс. Перед сбросом убедитесь, что несинхронизированных отчётов нет — они будут потеряны.
            </Typography.Text>
            <Button danger onClick={handleResetLocalDb} style={{ alignSelf: 'flex-start' }}>
              Сбросить локальную базу
            </Button>
          </Flex>
        </Card>
      </Space>
    </>
  )
}
