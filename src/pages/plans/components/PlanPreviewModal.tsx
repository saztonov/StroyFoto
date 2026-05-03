import { Button, Flex, Modal, Spin, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { plansPage } from '@/shared/i18n/ru'
import { planDisplayName, type PlanRecord } from '@/services/plans'
import { useIsDesktop } from '@/shared/hooks/useBreakpoint'
import { ZoomablePdfPreview } from './ZoomablePdfPreview'

interface Props {
  plan: PlanRecord | null
  blob: Blob | null
  loading: boolean
  page: number
  pageCount: number
  onPageChange: (next: number) => void
  onPageCountReady: (n: number) => void
  onClose: () => void
}

export function PlanPreviewModal({
  plan,
  blob,
  loading,
  page,
  pageCount,
  onPageChange,
  onPageCountReady,
  onClose,
}: Props) {
  const isDesktop = useIsDesktop()
  return (
    <Modal
      title={plan ? planDisplayName(plan) : plansPage.previewTitle}
      open={!!plan}
      onCancel={onClose}
      footer={null}
      width={isDesktop ? '90vw' : '100vw'}
      style={
        isDesktop
          ? { maxWidth: 960, top: 20 }
          : { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 }
      }
      styles={
        isDesktop
          ? undefined
          : {
              body: {
                padding: 8,
                maxHeight: 'calc(100dvh - 64px)',
                overflowY: 'auto',
              },
            }
      }
      destroyOnHidden
    >
      {loading && (
        <Flex justify="center" style={{ padding: 60 }}>
          <Spin size="large" />
        </Flex>
      )}
      {blob && (
        <>
          {pageCount > 1 && (
            <Flex justify="center" align="center" gap={12} style={{ marginBottom: 12 }}>
              <Button
                icon={<LeftOutlined />}
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
              />
              <Typography.Text>
                {page} {plansPage.pageOf} {pageCount}
              </Typography.Text>
              <Button
                icon={<RightOutlined />}
                disabled={page >= pageCount}
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              />
            </Flex>
          )}
          <ZoomablePdfPreview blob={blob} page={page} onPageCountReady={onPageCountReady} />
        </>
      )}
    </Modal>
  )
}
