import { useEffect, useState, useSyncExternalStore } from 'react'
import { Alert, Button, Space } from 'antd'
import { CloudSyncOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { getSyncSnapshot, subscribeSync, triggerSync } from '@/services/sync'
import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus'
import { countOpenSyncIssues } from '@/services/syncIssues'
import { onReportsChanged } from '@/services/invalidation'

export function SyncBanner() {
  const snap = useSyncExternalStore(
    (cb) => subscribeSync(cb) as unknown as () => void,
    getSyncSnapshot,
    getSyncSnapshot,
  )
  const online = useOnlineStatus()
  const [issues, setIssues] = useState(0)

  // Подгружаем и обновляем счётчик sync_issues. Источник — IDB, обновляется
  // на reportsChanged (в т.ч. cross-tab через BroadcastChannel в invalidation.ts)
  // и при каждом изменении snapshot из sync loop.
  useEffect(() => {
    let alive = true
    const refresh = () => {
      countOpenSyncIssues()
        .then((c) => { if (alive) setIssues(c) })
        .catch(() => undefined)
    }
    refresh()
    const unsub = onReportsChanged(refresh)
    return () => {
      alive = false
      unsub()
    }
  }, [snap.pending, snap.failed])

  if (!online) {
    return (
      <Alert
        type="warning"
        showIcon
        banner
        message="Нет интернета. Изменения сохраняются локально и отправятся при появлении сети."
      />
    )
  }
  if (issues > 0) {
    return (
      <Alert
        type="warning"
        showIcon
        banner
        icon={<WarningOutlined />}
        message={`Проблем синхронизации: ${issues}. Откройте отчёт с пометкой «Конфликт» — там подробности.`}
      />
    )
  }
  if (snap.state === 'syncing') {
    return <Alert type="info" showIcon banner message="Синхронизация…" />
  }
  if (snap.failed > 0) {
    return (
      <Alert
        type="error"
        showIcon
        banner
        message={`Не удалось отправить отчётов: ${snap.failed}${snap.lastError ? ` — ${snap.lastError}` : ''}`}
        action={
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            onClick={() => triggerSync()}
          >
            Повторить
          </Button>
        }
      />
    )
  }
  if (snap.pending > 0) {
    return (
      <Alert
        type="info"
        showIcon
        banner
        message={`Ожидают синхронизации: ${snap.pending}`}
        action={
          <Space>
            <Button
              size="small"
              type="link"
              icon={<CloudSyncOutlined />}
              onClick={() => triggerSync()}
            >
              Синхронизировать
            </Button>
          </Space>
        }
      />
    )
  }
  if (snap.state === 'error' && snap.lastError) {
    return (
      <Alert
        type="error"
        showIcon
        banner
        message={`Ошибка синхронизации: ${snap.lastError}`}
        action={
          <Button size="small" type="link" icon={<ReloadOutlined />} onClick={() => triggerSync()}>
            Повторить
          </Button>
        }
      />
    )
  }
  return null
}
