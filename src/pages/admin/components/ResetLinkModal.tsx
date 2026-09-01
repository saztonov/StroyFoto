import { Alert, Flex, Modal, Typography } from 'antd'
import { passwordReset } from '@/shared/i18n/ru'

interface Props {
  url: string | null
  onClose: () => void
}

/**
 * Показывает выданную ссылку. Токен приходит с сервера ровно один раз —
 * в БД лежит только его хэш, поэтому показать ссылку повторно нечего.
 */
export function ResetLinkModal({ url, onClose }: Props) {
  return (
    <Modal
      open={url !== null}
      title={passwordReset.linkTitle}
      onCancel={onClose}
      onOk={onClose}
      okText={passwordReset.linkClose}
      cancelButtonProps={{ style: { display: 'none' } }}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Alert type="warning" showIcon message={passwordReset.linkWarning} />
        <Typography.Paragraph
          copyable={{ text: url ?? '', tooltips: ['Скопировать', 'Скопировано'] }}
          style={{ wordBreak: 'break-all', marginBottom: 0 }}
        >
          {url}
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {passwordReset.linkHint}
        </Typography.Text>
      </Flex>
    </Modal>
  )
}
