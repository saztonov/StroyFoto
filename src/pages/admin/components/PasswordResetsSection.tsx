import { useState } from 'react'
import { App, Badge, Button, Card, Flex, List, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useIsDesktop } from '@/shared/hooks/useBreakpoint'
import { cancelPasswordReset } from '@/services/admin'
import { mapAuthError } from '@/services/auth'
import {
  isOpenRequest,
  type PasswordResetRequest,
} from '@/entities/passwordReset/types'
import { passwordReset } from '@/shared/i18n/ru'

interface Props {
  requests: PasswordResetRequest[]
  loading: boolean
  /** Выдача ссылки живёт в UsersPage: та же кнопка есть и в строке таблицы. */
  onIssue: (userId: string) => void
  issuingFor: string | null
  onChanged: () => void
}

function statusTag(r: PasswordResetRequest) {
  if (r.status === 'used') return <Tag color="green">{passwordReset.statusUsed}</Tag>
  if (r.status === 'cancelled') return <Tag>{passwordReset.statusCancelled}</Tag>
  if (r.status === 'pending') return <Tag color="orange">{passwordReset.statusPending}</Tag>
  // issued: истёкшая ссылка — уже не ожидающая заявка.
  if (r.link_expired) return <Tag color="red">{passwordReset.statusExpired}</Tag>
  return (
    <Tag color="blue">
      {passwordReset.statusIssued}
      {r.token_expires_at
        ? `, ${passwordReset.validUntil(dayjs(r.token_expires_at).format('DD.MM HH:mm'))}`
        : ''}
    </Tag>
  )
}

function requestedText(r: PasswordResetRequest): string {
  const when = dayjs(r.last_requested_at).format('DD.MM.YYYY HH:mm')
  return r.request_count > 1
    ? `${when} (${passwordReset.repeatedTimes(r.request_count)})`
    : when
}

export function PasswordResetsSection({
  requests,
  loading,
  onIssue,
  issuingFor,
  onChanged,
}: Props) {
  const { message, modal } = App.useApp()
  const isDesktop = useIsDesktop()
  const [cancelling, setCancelling] = useState<string | null>(null)

  // Карточку не показываем, пока показывать нечего.
  if (!loading && requests.length === 0) return null

  const openCount = requests.filter(isOpenRequest).length

  function handleCancel(r: PasswordResetRequest) {
    modal.confirm({
      title: passwordReset.cancelConfirm,
      okText: passwordReset.cancelAction,
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelling(r.id)
        try {
          await cancelPasswordReset(r.id)
          message.success(passwordReset.cancelled)
          onChanged()
        } catch (e) {
          message.error(mapAuthError(e))
          // Список мог разойтись с сервером (заявку уже закрыли) — перечитываем.
          onChanged()
        } finally {
          setCancelling(null)
        }
      },
    })
  }

  function actions(r: PasswordResetRequest) {
    if (!isOpenRequest(r) && r.status !== 'issued') return null
    return (
      <Space size="small" wrap>
        <Button
          size="small"
          type="primary"
          loading={issuingFor === r.user_id}
          onClick={() => onIssue(r.user_id)}
        >
          {passwordReset.issueAction}
        </Button>
        <Button size="small" loading={cancelling === r.id} onClick={() => handleCancel(r)}>
          {passwordReset.cancelAction}
        </Button>
      </Space>
    )
  }

  const columns: ColumnsType<PasswordResetRequest> = [
    {
      title: 'Пользователь',
      key: 'user',
      render: (_, r) => (
        <Flex vertical>
          <Typography.Text>{r.full_name || r.email}</Typography.Text>
          {r.full_name ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.email}
            </Typography.Text>
          ) : null}
        </Flex>
      ),
    },
    {
      title: passwordReset.requestedAt,
      key: 'requested',
      width: 220,
      render: (_, r) => requestedText(r),
    },
    { title: 'Статус', key: 'status', width: 220, render: (_, r) => statusTag(r) },
    { title: 'Действия', key: 'actions', width: 220, render: (_, r) => actions(r) },
  ]

  return (
    <Card
      title={
        <Space>
          {passwordReset.queueTitle}
          {openCount > 0 ? <Badge count={openCount} /> : null}
        </Space>
      }
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: isDesktop ? 0 : 12 } }}
    >
      {isDesktop ? (
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={requests}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 720 }}
          size="middle"
        />
      ) : (
        <List
          loading={loading}
          dataSource={requests}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          renderItem={(r) => (
            <List.Item style={{ padding: '6px 0', border: 'none' }}>
              <Card size="small" style={{ width: '100%' }}>
                <Flex vertical gap={6}>
                  <Typography.Text strong>{r.full_name || r.email}</Typography.Text>
                  {r.full_name ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.email}
                    </Typography.Text>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {passwordReset.requestedAt}: {requestedText(r)}
                  </Typography.Text>
                  <div>{statusTag(r)}</div>
                  {actions(r)}
                </Flex>
              </Card>
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}
