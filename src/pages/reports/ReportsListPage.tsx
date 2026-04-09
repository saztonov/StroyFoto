import { useEffect, useState } from 'react'
import { Badge, Button, Empty, List, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, nav } from '@/shared/i18n/ru'
import { listLocalReports } from '@/services/localReports'
import type { LocalReport, SyncStatus } from '@/lib/db'
import { subscribeSync } from '@/services/sync'

const STATUS_LABEL: Record<SyncStatus, { text: string; color: string }> = {
  pending: { text: 'Ожидает синхронизации', color: 'gold' },
  syncing: { text: 'Синхронизируется', color: 'blue' },
  synced: { text: 'Синхронизировано', color: 'green' },
  failed: { text: 'Ошибка синхронизации', color: 'red' },
  pending_upload: { text: 'Фото ждут загрузки', color: 'purple' },
}

export function ReportsListPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<LocalReport[]>([])

  const reload = () => {
    void listLocalReports().then(setReports)
  }

  useEffect(() => {
    reload()
    const unsub = subscribeSync(() => reload())
    return () => {
      unsub()
    }
  }, [])

  return (
    <>
      <PageHeader
        title={nav.reports}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/reports/new')}>
            {actions.newReport}
          </Button>
        }
      />
      {reports.length === 0 ? (
        <Empty description="Локальных отчётов пока нет" />
      ) : (
        <List
          dataSource={reports}
          renderItem={(r) => {
            const s = STATUS_LABEL[r.syncStatus]
            return (
              <List.Item>
                <List.Item.Meta
                  title={
                    <span>
                      <Badge status={r.syncStatus === 'synced' ? 'success' : 'processing'} />{' '}
                      {new Date(r.createdAt).toLocaleString('ru-RU')}
                    </span>
                  }
                  description={
                    <span>
                      <Tag color={s.color}>{s.text}</Tag>
                      {r.description ? (
                        <Typography.Text type="secondary">{r.description}</Typography.Text>
                      ) : null}
                    </span>
                  }
                />
              </List.Item>
            )
          }}
        />
      )}
    </>
  )
}
