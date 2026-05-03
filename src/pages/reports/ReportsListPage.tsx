import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Col,
  DatePicker,
  Empty,
  Flex,
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
import { onReportsChanged } from '@/services/invalidation'
import { loadMergedReports, type ReportCard } from '@/services/reports'
import { listOpenSyncIssues } from '@/services/syncIssues'
import { loadProjectsForUser, loadWorkTypes, loadPerformers, loadWorkAssignments } from '@/services/catalogs'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { SYNC_STATUS_LABEL } from './lib/syncStatusLabel'

interface ReportCardItemProps {
  report: ReportCard
  projectName: string
  workTypeName: string | null
  workAssignmentName: string | null
  performerName: string | null
  hasIssue: boolean
  onOpen: (id: string) => void
}

const ReportCardItem = memo(function ReportCardItem({
  report,
  projectName,
  workTypeName,
  workAssignmentName,
  performerName,
  hasIssue,
  onOpen,
}: ReportCardItemProps) {
  const s = SYNC_STATUS_LABEL[report.syncStatus] ?? { text: report.syncStatus ?? '—', color: 'default' }
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
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Space size={8} wrap style={{ minWidth: 0 }}>
        <Badge status={report.syncStatus === 'synced' ? 'success' : 'processing'} />
        <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
          {projectName}
        </Typography.Text>
        <Typography.Text type="secondary">
          {dayjs(report.createdAt).format('DD.MM.YYYY HH:mm')}
        </Typography.Text>
      </Space>
      <div style={{ marginTop: 6 }}>
        <Space size={8} wrap style={{ minWidth: 0 }}>
          <Tag color={s.color}>{s.text}</Tag>
          {hasIssue && <Tag color="volcano">Конфликт</Tag>}
          {report.remoteOnly && <Tag color="default">{reportsList.remoteTag}</Tag>}
          {performerName && (
            <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
              {performerName}
            </Typography.Text>
          )}
          {workTypeName && (
            <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
              {workTypeName}
            </Typography.Text>
          )}
          {workAssignmentName && (
            <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
              {workAssignmentName}
            </Typography.Text>
          )}
          {report.description && (
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: '100%' }}>
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
  const [workAssignments, setWorkAssignments] = useState<WorkAssignment[]>([])
  const [loading, setLoading] = useState(true)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [workTypeIds, setWorkTypeIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'date' | 'performer'>('date')
  const [issueReportIds, setIssueReportIds] = useState<Set<string>>(new Set())

  const monthOptions = useMemo(() => {
    const now = dayjs()
    return [0, 1, 2].map((delta) => {
      const m = now.subtract(delta, 'month')
      return { key: m.format('YYYY-MM'), label: m.format('MMMM YYYY') }
    })
  }, [])

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
    void loadWorkAssignments().then(setWorkAssignments).catch(() => undefined)
    const refreshIssues = () => {
      listOpenSyncIssues()
        .then((list) => setIssueReportIds(new Set(list.map((i) => i.reportId))))
        .catch(() => undefined)
    }
    refreshIssues()
    const unsub = onReportsChanged(() => {
      reload()
      refreshIssues()
    })
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
  const workAssignmentsById = useMemo(
    () => new Map(workAssignments.map((w) => [w.id, w])),
    [workAssignments],
  )

  const filtered = useMemo(() => {
    const monthSet = new Set(selectedMonths)
    const workTypeSet = new Set(workTypeIds)
    const from = range?.[0]?.startOf('day').valueOf() ?? null
    const to = range?.[1]?.endOf('day').valueOf() ?? null
    return reports.filter((r) => {
      if (projectId && r.projectId !== projectId) return false
      if (monthSet.size > 0) {
        const m = r.createdAt.slice(0, 7)
        if (!monthSet.has(m)) return false
      }
      if (from != null || to != null) {
        const t = Date.parse(r.createdAt)
        if (from != null && t < from) return false
        if (to != null && t > to) return false
      }
      if (workTypeSet.size > 0 && !workTypeSet.has(r.workTypeId)) return false
      return true
    })
  }, [reports, projectId, selectedMonths, range, workTypeIds])

  const hasFilters =
    projectId != null ||
    selectedMonths.length > 0 ||
    range != null ||
    workTypeIds.length > 0

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

      <Flex gap={8} wrap="wrap" align="center" style={{ marginBottom: 16 }}>
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
          getPopupContainer={() => document.body}
        />
        <Space size={6} wrap>
          {monthOptions.map((m) => (
            <Tag.CheckableTag
              key={m.key}
              checked={selectedMonths.includes(m.key)}
              onChange={(checked) => {
                setSelectedMonths((prev) =>
                  checked ? [...prev, m.key] : prev.filter((x) => x !== m.key),
                )
              }}
            >
              {m.label}
            </Tag.CheckableTag>
          ))}
        </Space>
        <DatePicker.RangePicker
          value={range as never}
          onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)}
          format="DD.MM.YYYY"
          placeholder={[reportsList.filterDateRange, '']}
          getPopupContainer={() => document.body}
        />
        <Select
          mode="multiple"
          allowClear
          showSearch
          placeholder={reportsList.filterWorkType}
          style={{ minWidth: 220, maxWidth: 420 }}
          value={workTypeIds}
          onChange={(v) => setWorkTypeIds(v)}
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={workTypes.map((w) => ({ value: w.id, label: w.name }))}
          maxTagCount="responsive"
          getPopupContainer={() => document.body}
        />
        {hasFilters && (
          <Button
            onClick={() => {
              setProjectId(null)
              setSelectedMonths([])
              setRange(null)
              setWorkTypeIds([])
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
                workAssignmentName={
                  r.workAssignmentId ? workAssignmentsById.get(r.workAssignmentId)?.name ?? null : null
                }
                performerName={performersById.get(r.performerId)?.name ?? null}
                hasIssue={issueReportIds.has(r.id)}
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
                        workAssignmentName={
                          r.workAssignmentId
                            ? workAssignmentsById.get(r.workAssignmentId)?.name ?? null
                            : null
                        }
                        performerName={null}
                        hasIssue={issueReportIds.has(r.id)}
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
