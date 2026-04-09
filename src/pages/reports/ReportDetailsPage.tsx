import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { actions, emptyStates } from '@/shared/i18n/ru'

export function ReportDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return (
    <>
      <PageHeader
        title="Отчёт"
        subtitle={id ? `ID: ${id}` : undefined}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            {actions.back}
          </Button>
        }
      />
      <EmptySection title="Детали отчёта" description={emptyStates.soon} />
    </>
  )
}
