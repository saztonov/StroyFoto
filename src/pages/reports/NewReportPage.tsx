import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { actions, emptyStates } from '@/shared/i18n/ru'

export function NewReportPage() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader
        title="Новый отчёт"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            {actions.back}
          </Button>
        }
      />
      <EmptySection
        title="Форма создания отчёта"
        description={emptyStates.soon}
      />
    </>
  )
}
