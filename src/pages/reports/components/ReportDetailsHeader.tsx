import { Button, Popconfirm, Space, Tooltip } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, reportDetails } from '@/shared/i18n/ru'

interface Props {
  canEdit: boolean
  canShowEditDisabled: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
  onBack: () => void
}

export function ReportDetailsHeader({
  canEdit,
  canShowEditDisabled,
  deleting,
  onEdit,
  onDelete,
  onBack,
}: Props) {
  return (
    <PageHeader
      title={reportDetails.title}
      extra={
        <Space size={8} wrap>
          {canEdit && (
            <Button icon={<EditOutlined />} onClick={onEdit}>
              {actions.edit}
            </Button>
          )}
          {canEdit && (
            <Popconfirm
              title={reportDetails.deleteConfirmTitle}
              description={reportDetails.deleteConfirmContent}
              onConfirm={onDelete}
              okText={actions.delete}
              cancelText={actions.cancel}
              okButtonProps={{ danger: true, loading: deleting }}
            >
              <Button danger icon={<DeleteOutlined />} loading={deleting}>
                {actions.delete}
              </Button>
            </Popconfirm>
          )}
          {canShowEditDisabled && (
            <Tooltip title={reportDetails.cannotEditLocal}>
              <Button icon={<EditOutlined />} disabled>
                {actions.edit}
              </Button>
            </Tooltip>
          )}
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            {actions.back}
          </Button>
        </Space>
      }
    />
  )
}
