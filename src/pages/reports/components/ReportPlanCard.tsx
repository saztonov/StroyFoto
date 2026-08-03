import { Button, Card, Flex, Select, Space, Tag, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { planMarks, reportDetails } from '@/shared/i18n/ru'
import { planDisplayName } from '@/services/plans'
import type { PlanRow } from '@/services/catalogs'
import { PdfPlanCanvas, type PdfPlanPoint } from './PdfPlanCanvas'
import type { LoadedReport } from '../types'

interface Props {
  data: LoadedReport
  plan: PlanRow | undefined
  plans: PlanRow[]
  planBlob: Blob | null
  planError: string | null
  planCachedOffline: boolean
  /** Какой план и страница открыты сейчас: точки могут быть на разных. */
  viewPlanId: string | null
  viewPage: number
  onViewPlanChange: (planId: string | null) => void
  onViewPageChange: (page: number) => void
  /** Клик по точке фотографии — открыть соответствующий кадр. */
  onPointClick?: (photoId: string) => void
}

export function ReportPlanCard({
  data,
  plan,
  plans,
  planBlob,
  planError,
  planCachedOffline,
  viewPlanId,
  viewPage,
  onViewPlanChange,
  onViewPageChange,
  onPointClick,
}: Props) {
  if (!data.card.planId && !data.mark && data.photoMarks.length === 0) {
    return (
      <Card title={reportDetails.sectionPlan}>
        <Typography.Text type="secondary">{reportDetails.noMark}</Typography.Text>
      </Card>
    )
  }

  // Планы, на которых у отчёта реально что-то есть.
  const usedPlanIds = new Set<string>()
  if (data.card.planId) usedPlanIds.add(data.card.planId)
  if (data.mark) usedPlanIds.add(data.mark.planId)
  for (const m of data.photoMarks) usedPlanIds.add(m.planId)
  const planOptions = plans
    .filter((p) => usedPlanIds.has(p.id))
    .map((p) => ({ value: p.id, label: planDisplayName(p) }))

  // Показываем только точки открытых плана и страницы.
  const points: PdfPlanPoint[] = []
  if (data.mark && data.mark.planId === viewPlanId && data.mark.page === viewPage) {
    points.push({
      id: 'report',
      xNorm: data.mark.xNorm,
      yNorm: data.mark.yNorm,
      ariaLabel: planMarks.wholeReport,
    })
  }
  data.photoMarks.forEach((m, idx) => {
    if (m.planId !== viewPlanId || m.page !== viewPage) return
    points.push({
      id: m.photoId,
      xNorm: m.xNorm,
      yNorm: m.yNorm,
      label: String(idx + 1),
      ariaLabel: `${planMarks.photoNumber} ${idx + 1}`,
    })
  })

  // Верхняя граница листания — самая дальняя страница с точками: иначе стрелка
  // уводила бы в пустые страницы плана.
  const pagesWithMarks: number[] = []
  if (data.mark && data.mark.planId === viewPlanId) pagesWithMarks.push(data.mark.page)
  for (const m of data.photoMarks) {
    if (m.planId === viewPlanId) pagesWithMarks.push(m.page)
  }
  const maxPage = Math.max(viewPage, ...(pagesWithMarks.length > 0 ? pagesWithMarks : [1]))

  return (
    <Card title={reportDetails.sectionPlan}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {planOptions.length > 1 ? (
          <Select
            value={viewPlanId ?? undefined}
            onChange={(v) => onViewPlanChange(v ?? null)}
            options={planOptions}
            style={{ minWidth: 220 }}
          />
        ) : (
          <Typography.Text strong>{plan ? planDisplayName(plan) : '—'}</Typography.Text>
        )}

        <Flex gap={8} align="center" wrap="wrap">
          <Button
            size="small"
            icon={<LeftOutlined />}
            onClick={() => onViewPageChange(Math.max(1, viewPage - 1))}
            disabled={viewPage <= 1}
          />
          <Typography.Text>
            {reportDetails.pageLabel} {viewPage}
          </Typography.Text>
          <Button
            size="small"
            icon={<RightOutlined />}
            onClick={() => onViewPageChange(viewPage + 1)}
            disabled={viewPage >= maxPage}
          />
          {data.photoMarks.length > 0 && (
            <Typography.Text type="secondary">
              {planMarks.stripLabel}: {data.photoMarks.length}
            </Typography.Text>
          )}
        </Flex>

        {planCachedOffline && <Tag color="green">{reportDetails.planOffline}</Tag>}
        {planError && (
          <Typography.Text type="secondary">Не удалось открыть PDF: {planError}</Typography.Text>
        )}
        {planBlob && (
          <PdfPlanCanvas
            blob={planBlob}
            page={viewPage}
            points={points}
            // Общая метка отчёта фотографии не соответствует — открывать нечего.
            onPointClick={
              onPointClick ? (id) => { if (id !== 'report') onPointClick(id) } : undefined
            }
          />
        )}
      </Space>
    </Card>
  )
}
