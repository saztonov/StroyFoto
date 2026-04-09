import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Col,
  DatePicker,
  Empty,
  Flex,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, nav, reportsList } from '@/shared/i18n/ru'
import type { SyncStatus } from '@/lib/db'
import { subscribeSync } from '@/services/sync'
import { loadMergedReports, type ReportCard } from '@/services/reports'
import { loadProjectsForUser, loadWorkTypes } from '@/services/catalogs'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'

const STATUS_LABEL: Record<SyncStatus, { text: string; color: string }> = {
  pending: { text: 'Ожидает синхронизации', color: 'gold' },
  syncing: { text: 'Синхронизируется', color: 'blue' },
  synced: { text: 'Синхронизировано', color: 'green' },
  failed: { text: 'Ошибка синхронизации', color: 'red' },
  pending_upload: { text: 'Фото ждут загрузки', color: 'purple' },
}

interface ReportCardItemProps {
  report: ReportCard
  projectName: string
  workTypeName: string | null
  onOpen: (id: string) => void
}

const ReportCardItem = memo(function ReportCardItem({
  report,
  projectName,
  workTypeName,
  onOpen,
}: ReportCardItemProps) {
  const s = STATUS_LABEL[report.syncStatus]
  return (
    <div
      onClick={() => onOpen(report.id)}
      style={{
        cursor: 'pointer',
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--ant-color-border-secondary, rgba(0,0,0,0.06))',
        background: 'var(--ant-color-bg-container, #fff)',
        height: '100%',
      }}
    >
      <Space size={8} wrap>
        <Badge status={report.syncStatus === 'synced' ? 'success' : 'processing'} />
        <Typography.Text strong>{projectName}</Typography.Text>
        <Typography.Text type="secondary">
          {dayjs(report.createdAt).format('DD.MM.YYYY HH:mm')}
        </Typography.Text>
      </Space>
      <div style={{ marginTop: 6 }}>
        <Space size={8} wrap>
          <Tag color={s.color}>{s.text}</Tag>
          {report.remoteOnly && <Tag color="default">{reportsList.remoteTag}</Tag>}
          {workTypeName && (
            <Typography.Text type="secondary">{workTypeName}</Typography.Text>
          )}
          {report.description && (
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
              {report.description}
            </Typography.Text>
          )}
        </Space>
      </div>
    </div>
  )
})

export function ReportsListPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReportCard[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [loading, setLoading] = useState(true)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [workTypeQuery, setWorkTypeQuery] = useState('')

  const reload = useCallback(() => {
    void loadMergedReports().then((r) => {
      setReports(r)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    reload()
    void loadProjectsForUser().then(setProjects).catch(() => undefined)
    void loadWorkTypes().then(setWorkTypes).catch(() => undefined)
    const unsub = subscribeSync(() => reload())
    return () => {
      unsub()
    }
  }, [reload])

  const openReport = useCallback((id: string) => navigate(`/reports/${id}`), [navigate])

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  )
  const workTypesById = useMemo(
    () => new Map(workTypes.map((w) => [w.id, w])),
    [workTypes],
  )

  const filtered = useMemo(() => {
    const q = workTypeQuery.trim().toLowerCase()
    const from = range?.[0]?.startOf('day').valueOf() ?? null
    const to = range?.[1]?.endOf('day').valueOf() ?? null
    return reports.filter((r) => {
      if (projectId && r.projectId !== projectId) return false
      if (from != null || to != null) {
        const t = new Date(r.createdAt).getTime()
        if (from != null && t < from) return false
        if (to != null && t > to) return false
      }
      if (q) {
        const wt = workTypesById.get(r.workTypeId)
        if (!wt || !wt.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [reports, projectId, range, workTypeQuery, workTypesById])

  const hasFilters = projectId != null || range != null || workTypeQuery !== ''

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

      <Flex gap={8} wrap="wrap" style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder={reportsList.filterProjectAll}
          style={{ minWidth: 200 }}
          value={projectId ?? undefined}
          onChange={(v) => setProjectId(v ?? null)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
        <DatePicker.RangePicker
          value={range as never}
          onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)}
          format="DD.MM.YYYY"
          placeholder={[reportsList.filterDateRange, '']}
        />
        <Input.Search
          placeholder={reportsList.filterWorkType}
          allowClear
          value={workTypeQuery}
          onChange={(e) => setWorkTypeQuery(e.target.value)}
          style={{ minWidth: 220, maxWidth: 320 }}
        />
        {hasFilters && (
          <Button
            onClick={() => {
              setProjectId(null)
              setRange(null)
              setWorkTypeQuery('')
            }}
          >
            {reportsList.filterReset}
          </Button>
        )}
      </Flex>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : filtered.length === 0 ? (
        <Empty
          description={
            reports.length === 0 ? reportsList.emptyLocal : reportsList.emptyFiltered
          }
        />
      ) : (
        <Row gutter={[12, 12]}>
          {filtered.map((r) => (
            <Col key={r.id} xs={24} sm={12} xl={8}>
              <ReportCardItem
                report={r}
                projectName={projectsById.get(r.projectId)?.name ?? '—'}
                workTypeName={workTypesById.get(r.workTypeId)?.name ?? null}
                onOpen={openReport}
              />
            </Col>
          ))}
        </Row>
      )}
    </>
  )
}
