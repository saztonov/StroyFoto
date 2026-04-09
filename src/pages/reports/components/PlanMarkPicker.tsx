import { Alert, Select, Typography } from 'antd'
import type { PlanRow } from '@/services/catalogs'
import { env } from '@/shared/config/env'

export interface PlanMarkValue {
  planId: string
  page: number
  xNorm: number
  yNorm: number
}

interface Props {
  plans: PlanRow[]
  value: PlanMarkValue | null
  onChange: (next: PlanMarkValue | null) => void
}

/**
 * MVP-версия. Полноценный рендер PDF через pdfjs-dist + клик-постановка точки
 * подключается, как только появится edge-функция выдачи presigned URL к R2:
 * без неё мы физически не можем загрузить файл из приватного бакета.
 * До тех пор позволяем выбрать план (для привязки), но без точки.
 */
export function PlanMarkPicker({ plans, value, onChange }: Props) {
  if (!env.presignUrl) {
    return (
      <Alert
        type="info"
        showIcon
        message="Планы и точки появятся после подключения R2"
        description="Edge-функция для выдачи ссылок на приватные PDF ещё не настроена. Создавать отчёты можно без точки на плане."
      />
    )
  }

  if (plans.length === 0) {
    return <Typography.Text type="secondary">У проекта пока нет загруженных планов</Typography.Text>
  }

  return (
    <Select
      placeholder="Выберите план"
      allowClear
      value={value?.planId}
      onChange={(planId) => {
        if (!planId) {
          onChange(null)
          return
        }
        onChange({ planId, page: 1, xNorm: 0.5, yNorm: 0.5 })
      }}
      options={plans.map((p) => ({ value: p.id, label: p.name }))}
    />
  )
}
