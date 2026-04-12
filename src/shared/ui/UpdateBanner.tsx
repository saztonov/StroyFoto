import { useSyncExternalStore } from 'react'
import { Alert, Button } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { getUpdateSnapshot, subscribeUpdate, applyUpdate } from '@/services/appUpdate'
import { update as updateStrings } from '@/shared/i18n/ru'

export function UpdateBanner() {
  const available = useSyncExternalStore(subscribeUpdate, getUpdateSnapshot, () => false)

  if (!available) return null

  return (
    <Alert
      type="info"
      showIcon
      banner
      message={updateStrings.available}
      action={
        <Button size="small" type="link" icon={<SyncOutlined />} onClick={applyUpdate}>
          {updateStrings.apply}
        </Button>
      }
    />
  )
}
