import { useSyncExternalStore } from 'react'
import { Alert, Button } from 'antd'
import { CloudSyncOutlined } from '@ant-design/icons'
import { getSyncSnapshot, subscribeSync, triggerSync } from '@/services/sync'
import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus'

export function SyncBanner() {
  const snap = useSyncExternalStore(
    (cb) => {
      const unsub = subscribeSync(cb)
      return () => {
        unsub
      }
    },
    getSyncSnapshot,
    getSyncSnapshot,
  )
  const online = useOnlineStatus()

  if (!online) {
    return (
      <Alert
        type="warning"
        showIcon
        banner
        message="Нет интернета. Отчёты сохраняются локально и отправятся при появлении сети."
      />
    )
  }
  if (snap.state === 'syncing') {
    return <Alert type="info" showIcon banner message="Синхронизация…" />
  }
  if (snap.pending > 0) {
    return (
      <Alert
        type="info"
        showIcon
        banner
        message={`Ожидают синхронизации: ${snap.pending}`}
        action={
          <Button
            size="small"
            type="link"
            icon={<CloudSyncOutlined />}
            onClick={() => triggerSync()}
          >
            Синхронизировать
          </Button>
        }
      />
    )
  }
  if (snap.state === 'error' && snap.lastError) {
    return <Alert type="error" showIcon banner message={`Ошибка синхронизации: ${snap.lastError}`} />
  }
  return null
}
