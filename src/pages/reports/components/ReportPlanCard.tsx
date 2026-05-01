import { Card, Space, Tag, Typography } from 'antd'
import { reportDetails } from '@/shared/i18n/ru'
import { planDisplayName } from '@/services/plans'
import type { PlanRow } from '@/services/catalogs'
import { PdfPlanCanvas } from './PdfPlanCanvas'
import type { LoadedReport } from '../types'

interface Props {
  data: LoadedReport
  plan: PlanRow | undefined
  planBlob: Blob | null
  planError: string | null
  planCachedOffline: boolean
}

export function ReportPlanCard({ data, plan, planBlob, planError, planCachedOffline }: Props) {
  if (!data.card.planId && !data.mark) {
    return (
      <Card title={reportDetails.sectionPlan}>
        <Typography.Text type="secondary">{reportDetails.noMark}</Typography.Text>
      </Card>
    )
  }

  return (
    <Card title={reportDetails.sectionPlan}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Typography.Text strong>{plan ? planDisplayName(plan) : '—'}</Typography.Text>
        {data.mark && (
          <Typography.Text>
            {reportDetails.pageLabel} {data.mark.page} · {reportDetails.point}{' '}
            {(data.mark.xNorm * 100).toFixed(1)}% × {(data.mark.yNorm * 100).toFixed(1)}%
          </Typography.Text>
        )}
        {planCachedOffline && <Tag color="green">{reportDetails.planOffline}</Tag>}
        {planError && (
          <Typography.Text type="secondary">Не удалось открыть PDF: {planError}</Typography.Text>
        )}
        {planBlob && (
          <PdfPlanCanvas
            blob={planBlob}
            page={data.mark?.page ?? 1}
            value={data.mark ? { xNorm: data.mark.xNorm, yNorm: data.mark.yNorm } : null}
          />
        )}
      </Space>
    </Card>
  )
}
