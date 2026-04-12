import { useEffect, useState } from 'react'
import { Alert, Button, Flex, Select, Space, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { PlanRow } from '@/services/catalogs'
import { downloadPlanPdf, planDisplayName, type PlanRecord } from '@/services/plans'
import { PdfPlanCanvas } from './PdfPlanCanvas'

export interface PlanMarkValue {
  planId: string
  page: number
  // Точка может отсутствовать: пользователь выбрал план, но ещё не кликнул.
  // В этом случае отчёт создаётся без записи в report_plan_marks, но с plan_id.
  xNorm: number | null
  yNorm: number | null
}

interface Props {
  plans: PlanRow[]
  value: PlanMarkValue | null
  onChange: (next: PlanMarkValue | null) => void
}

/**
 * Выбор плана, страницы и постановка точки. PDF загружается через presigned
 * GET в `downloadPlanPdf`, который кэширует blob в `plans_cache` (IDB) — на
 * втором заходе компонент работает офлайн.
 */
export function PlanMarkPicker({ plans, value, onChange }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number>(1)

  useEffect(() => {
    if (!value?.planId) {
      setBlob(null)
      setError(null)
      setPageCount(1)
      return
    }
    const plan = plans.find((p) => p.id === value.planId)
    if (!plan) return

    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const planRecord: PlanRecord = {
          id: plan.id,
          project_id: plan.project_id,
          name: plan.name,
          floor: plan.floor ?? null,
          building: plan.building ?? null,
          section: plan.section ?? null,
          r2_key: plan.r2_key,
          page_count: plan.page_count,
          uploaded_by: null,
          created_at: plan.created_at,
          updated_at: plan.created_at,
        }
        const b = await downloadPlanPdf(planRecord)
        if (!cancelled) setBlob(b)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value?.planId, plans])

  if (plans.length === 0) {
    return <Typography.Text type="secondary">У проекта пока нет загруженных планов</Typography.Text>
  }

  const page = value?.page ?? 1

  const handlePlanChange = (planId: string | null) => {
    if (!planId) {
      onChange(null)
      return
    }
    // При смене плана точка сбрасывается — координаты других PDF не имеют смысла.
    onChange({ planId, page: 1, xNorm: null, yNorm: null })
  }

  const handlePageShift = (delta: number) => {
    if (!value) return
    const next = Math.max(1, Math.min(pageCount, value.page + delta))
    if (next === value.page) return
    // Сохраняем координаты: точка привязана к странице, но пользователь
    // может хотеть перенести её — он просто кликнет заново.
    onChange({ ...value, page: next })
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Select
        placeholder="Выберите план"
        allowClear
        value={value?.planId}
        onChange={handlePlanChange}
        options={plans.map((p) => ({ value: p.id, label: planDisplayName(p) }))}
      />

      {value?.planId && (
        <>
          <Flex gap={8} align="center" wrap="wrap">
            <Button
              icon={<LeftOutlined />}
              onClick={() => handlePageShift(-1)}
              disabled={page <= 1}
            />
            <Typography.Text>
              Страница {page} из {pageCount}
            </Typography.Text>
            <Button
              icon={<RightOutlined />}
              onClick={() => handlePageShift(1)}
              disabled={page >= pageCount}
            />
            {value.xNorm != null && value.yNorm != null ? (
              <Typography.Text type="secondary">
                Точка: {(value.xNorm * 100).toFixed(1)}% × {(value.yNorm * 100).toFixed(1)}%
              </Typography.Text>
            ) : (
              <Typography.Text type="warning">Кликните по плану, чтобы поставить точку</Typography.Text>
            )}
            <Button size="small" onClick={() => onChange(null)}>
              Очистить
            </Button>
          </Flex>

          {loading && <Typography.Text type="secondary">Загрузка PDF…</Typography.Text>}
          {error && (
            <Alert type="error" showIcon message="Не удалось загрузить план" description={error} />
          )}
          {blob && (
            <PdfPlanCanvas
              blob={blob}
              page={page}
              value={
                value.xNorm != null && value.yNorm != null
                  ? { xNorm: value.xNorm, yNorm: value.yNorm }
                  : null
              }
              onPageCountReady={setPageCount}
              onPick={(p) => onChange({ ...value, xNorm: p.xNorm, yNorm: p.yNorm })}
            />
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Кликните по плану, чтобы поставить или перенести точку.
          </Typography.Text>
        </>
      )}
    </Space>
  )
}
