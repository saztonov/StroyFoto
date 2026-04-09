import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { actions, emptyStates, nav } from '@/shared/i18n/ru'

export function ReportsListPage() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader
        title={nav.reports}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/reports/new')}>
            {actions.newReport}
          </Button>
        }
      />
      <EmptySection title={emptyStates.noReports} description={emptyStates.noReportsHint} />
    </>
  )
}
