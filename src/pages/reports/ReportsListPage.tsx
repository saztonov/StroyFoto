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
  Segmented,
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
import { onReportsChanged } from '@/services/invalidation'
import { loadMergedReports, type ReportCard } from '@/services/reports'
import { loadProjectsForUser, loadWorkTypes, loadPerformers } from '@/services/catalogs'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'

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
  performerName: string | null
  onOpen: (id: string) => void
}

const ReportCardItem = memo(function ReportCardItem({
  report,
  projectName,
  workTypeName,
  performerName,
  onOpen,
}: ReportCardItemProps) {
  const s = STATUS_LABEL[report.syncStatus] ?? { text: report.syncStatus ?? '—', color: 'default' }
  return (
    <div
      onClick={() => onOpen(report.id)}
      style={{
        cursor: 'pointer',
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--ant-color-border-secondary)',
        background: 'var(--ant-color-bg-container)',
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
          {performerName && (
            <Typography.Text type="secondary">{performerName}</Typography.Text>
          )}
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
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [performers, setPerformers] = useState<Performer[]>([])
  const [loading, setLoading] = useState(true)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [workTypeQuery, setWorkTypeQuery] = useState('')
  const [viewMode, setViewMode] = useState<'date' | 'performer'>('date')

  const reload = useCallback(() => {
    void loadMergedReports()
      .then((result) => {
        setReports(result.cards)
        setHasMore(result.hasMore)
        setNextCursor(result.nextCursor)
      })
      .catch((err) => {
        console.error('loadMergedReports failed', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    void loadMergedReports(nextCursor)
      .then((result) => {
        setReports((prev) => [...prev, ...result.cards])
        setHasMore(result.hasMore)
        setNextCursor(result.nextCursor)
      })
      .catch((err) => console.error('loadMore failed', err))
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore])

  useEffect(() => {
    reload()
    void loadProjectsForUser().then(setProjects).catch(() => undefined)
    void loadWorkTypes().then(setWorkTypes).catch(() => undefined)
    void loadPerformers().then(setPerformers).catch(() => undefined)
    const unsub = onReportsChanged(() => reload())
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
  const performersById = useMemo(
    () => new Map(performers.map((p) => [p.id, p])),
    [performers],
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

  const groupedByPerformer = useMemo(() => {
    const map = new Map<string, { performer: Performer | null; reports: ReportCard[] }>()
    for (const r of filtered) {
      const key = r.performerId
      if (!map.has(key)) {
        map.set(key, { performer: performersById.get(key) ?? null, reports: [] })
      }
      map.get(key)!.reports.push(r)
    }
    return Array.from(map.values()).sort((a, b) => {
      const nameA = a.performer?.name ?? ''
      const nameB = b.performer?.name ?? ''
      return nameA.localeCompare(nameB, 'ru')
    })
  }, [filtered, performersById])

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
        <Segmented
          value={viewMode}
          onChange={(v) => setViewMode(v as 'date' | 'performer')}
          options={[
            { label: reportsList.viewByDate, value: 'date' },
            { label: reportsList.viewByPerformer, value: 'performer' },
          ]}
        />
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
      ) : viewMode === 'date' ? (
        <Row gutter={[12, 12]}>
          {filtered.map((r, idx) => (
            <Col key={r.id ?? idx} xs={24} sm={12} xl={8}>
              <ReportCardItem
                report={r}
                projectName={projectsById.get(r.projectId)?.name ?? '—'}
                workTypeName={workTypesById.get(r.workTypeId)?.name ?? null}
                performerName={performersById.get(r.performerId)?.name ?? null}
                onOpen={openReport}
              />
            </Col>
          ))}
        </Row>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {groupedByPerformer.map((group) => {
            const perf = group.performer
            const title = perf
              ? `${perf.name} · ${perf.kind === 'contractor' ? 'Подрядчик' : 'Собственные силы'}`
              : reportsList.performerUnknown
            return (
              <div key={perf?.id ?? '__unknown'}>
                <Typography.Title level={5} style={{ marginBottom: 8 }}>
                  {title}
                </Typography.Title>
                <Row gutter={[12, 12]}>
                  {group.reports.map((r, idx) => (
                    <Col key={r.id ?? idx} xs={24} sm={12} xl={8}>
                      <ReportCardItem
                        report={r}
                        projectName={projectsById.get(r.projectId)?.name ?? '—'}
                        workTypeName={workTypesById.get(r.workTypeId)?.name ?? null}
                        performerName={null}
                        onOpen={openReport}
                      />
                    </Col>
                  ))}
                </Row>
              </div>
            )
          })}
        </Space>
      )}

      {hasMore && !loading && filtered.length > 0 && (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={loadMore} loading={loadingMore}>
            Загрузить ещё
          </Button>
        </Flex>
      )}
    </>
  )
}
