import { useState } from 'react'
import { App, Button, Flex, List, Skeleton, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { EmptySection } from '@/shared/ui/EmptySection'
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
  /** Выдача ссылки живёт в UsersPage: та же операция есть и в строке таблицы. */
  onIssue: (userId: string) => void
  issuingFor: string | null
  onChanged: () => void
}

/** Закрытая заявка ничего не ждёт — действий у неё нет. */
function isActionable(r: PasswordResetRequest): boolean {
  // Истёкшая ссылка формально ещё `issued`: её можно перевыпустить или снять.
  return isOpenRequest(r) || r.status === 'issued'
}

/** Правая колонка: срок для живой ссылки, иначе — исход заявки. */
function meta(r: PasswordResetRequest) {
  if (r.status === 'used') {
    return <Tag color="green">{passwordReset.statusUsed}</Tag>
  }
  if (r.status === 'cancelled') {
    return <Tag>{passwordReset.statusCancelled}</Tag>
  }
  if (r.status === 'issued') {
    return r.link_expired ? (
      <Tag color="red">{passwordReset.statusExpired}</Tag>
    ) : (
      <Typography.Text type="secondary">
        {passwordReset.expiresAt(
          dayjs(r.token_expires_at).format('DD.MM.YYYY, HH:mm'),
        )}
      </Typography.Text>
    )
  }
  return (
    <Typography.Text type="secondary">
      {passwordReset.requestedAtValue(
        dayjs(r.last_requested_at).format('DD.MM.YYYY, HH:mm'),
      )}
      {r.request_count > 1 ? ` · ${passwordReset.repeatedTimes(r.request_count)}` : ''}
    </Typography.Text>
  )
}

export function PasswordResetsSection({
  requests,
  loading,
  onIssue,
  issuingFor,
  onChanged,
}: Props) {
  const { message, modal } = App.useApp()
  const [cancelling, setCancelling] = useState<string | null>(null)

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
        } catch (e) {
          message.error(mapAuthError(e))
        } finally {
          setCancelling(null)
          // Перечитываем в любом случае: при ошибке список наверняка разошёлся
          // с сервером (заявку успели закрыть в другом окне).
          onChanged()
        }
      },
    })
  }

  if (loading && requests.length === 0) {
    return <Skeleton active paragraph={{ rows: 4 }} />
  }

  if (requests.length === 0) {
    return <EmptySection title={passwordReset.queueEmpty} />
  }

  return (
    <List
      loading={loading}
      dataSource={requests}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      renderItem={(r) => (
        <List.Item style={{ padding: '12px 0' }}>
          {/* wrap: на узком экране правая часть переносится под ФИО. */}
          <Flex
            justify="space-between"
            align="center"
            gap={12}
            wrap
            style={{ width: '100%' }}
          >
            <Flex vertical style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong ellipsis={{ tooltip: r.full_name ?? undefined }}>
                {r.full_name || r.email}
              </Typography.Text>
              {r.full_name ? (
                <Typography.Text
                  type="secondary"
                  ellipsis={{ tooltip: r.email }}
                  style={{ fontSize: 12 }}
                >
                  {r.email}
                </Typography.Text>
              ) : null}
            </Flex>

            <Flex align="center" gap={12} wrap>
              {meta(r)}
              {isActionable(r) ? (
                <Space size="small" wrap>
                  <Button
                    type="primary"
                    loading={issuingFor === r.user_id}
                    onClick={() => onIssue(r.user_id)}
                  >
                    {r.status === 'issued'
                      ? passwordReset.reissueAction
                      : passwordReset.issueAction}
                  </Button>
                  <Button
                    loading={cancelling === r.id}
                    onClick={() => handleCancel(r)}
                  >
                    {passwordReset.cancelAction}
                  </Button>
                </Space>
              ) : null}
            </Flex>
          </Flex>
        </List.Item>
      )}
    />
  )
}
