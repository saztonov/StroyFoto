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
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, nav, reportsList } from '@/shared/i18n/ru'
import { onReportsChanged } from '@/services/invalidation'
import {
  loadMergedReports,
  type ReportCard,
  type RemoteReportPhoto,
} from '@/services/reports'
import { listOpenSyncIssues } from '@/services/syncIssues'
import { loadProjectsForUser, loadWorkTypes, loadPerformers, loadWorkAssignments } from '@/services/catalogs'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { SYNC_STATUS_LABEL } from './lib/syncStatusLabel'
import { PhotoFeedView } from './components/PhotoFeedView'

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

type ViewMode = 'date' | 'performer' | 'photos'

interface ParsedFilters {
  projectId: string | null
  selectedMonths: string[]
  range: [Dayjs | null, Dayjs | null] | null
  workTypeIds: string[]
  viewMode: ViewMode
}

const DATE_FMT = 'YYYY-MM-DD'

function parseFilters(sp: URLSearchParams): ParsedFilters {
  const project = sp.get('project')
  const monthsRaw = sp.get('months')
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const wtRaw = sp.get('wt')
  const viewRaw = sp.get('view')
  const view: ViewMode =
    viewRaw === 'performer' || viewRaw === 'photos' ? viewRaw : 'date'
  const fromDay = fromRaw ? dayjs(fromRaw, DATE_FMT) : null
  const toDay = toRaw ? dayjs(toRaw, DATE_FMT) : null
  const range: [Dayjs | null, Dayjs | null] | null =
    fromDay?.isValid() || toDay?.isValid()
      ? [fromDay?.isValid() ? fromDay : null, toDay?.isValid() ? toDay : null]
      : null
  return {
    projectId: project || null,
    selectedMonths: monthsRaw ? monthsRaw.split(',').filter(Boolean) : [],
    range,
    workTypeIds: wtRaw ? wtRaw.split(',').filter(Boolean) : [],
    viewMode: view,
  }
}

function serializeFilters(filters: ParsedFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.projectId) sp.set('project', filters.projectId)
  if (filters.selectedMonths.length > 0) {
    sp.set('months', filters.selectedMonths.join(','))
  }
  if (filters.range?.[0]) sp.set('from', filters.range[0].format(DATE_FMT))
  if (filters.range?.[1]) sp.set('to', filters.range[1].format(DATE_FMT))
  if (filters.workTypeIds.length > 0) {
    sp.set('wt', filters.workTypeIds.join(','))
  }
  if (filters.viewMode !== 'date') sp.set('view', filters.viewMode)
  return sp
}

export function ReportsListPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const { projectId, selectedMonths, range, workTypeIds, viewMode } = filters

  // Стабильный ключ для зависимостей useEffect — иначе каждый ререндер
  // searchParams создаёт новую ссылку и reload зацикливался бы.
  const filtersKey = useMemo(() => searchParams.toString(), [searchParams])

  const [reports, setReports] = useState<ReportCard[]>([])
  const [photosByReportId, setPhotosByReportId] = useState<
    Map<string, RemoteReportPhoto[]>
  >(new Map())
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [performers, setPerformers] = useState<Performer[]>([])
  const [workAssignments, setWorkAssignments] = useState<WorkAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [issueReportIds, setIssueReportIds] = useState<Set<string>>(new Set())

  const monthOptions = useMemo(() => {
    const now = dayjs()
    return [0, 1, 2].map((delta) => {
      const m = now.subtract(delta, 'month')
      return { key: m.format('YYYY-MM'), label: m.format('MMMM YYYY') }
    })
  }, [])

  // Конвертирует UI-фильтры в опции для loadMergedReports.
  // Range в URL хранится как YYYY-MM-DD (локальные даты), на сервер шлём
  // полноценный ISO с временем дня в UTC.
  const buildOpts = useCallback(
    (cursor?: string) => {
      const dateFrom = filters.range?.[0]
        ? filters.range[0].startOf('day').toISOString()
        : null
      const dateTo = filters.range?.[1]
        ? filters.range[1].endOf('day').toISOString()
        : null
      return {
        cursor,
        projectId: filters.projectId,
        workTypeIds: filters.workTypeIds.length > 0 ? filters.workTypeIds : undefined,
        months: filters.selectedMonths.length > 0 ? filters.selectedMonths : undefined,
        dateFrom,
        dateTo,
        includePhotos: filters.viewMode === 'photos',
      }
    },
    [filters],
  )

  const reload = useCallback(() => {
    setLoading(true)
    void loadMergedReports(buildOpts())
      .then((result) => {
        setReports(result.cards)
        setPhotosByReportId(result.photosByReportId ?? new Map())
        setHasMore(result.hasMore)
        setNextCursor(result.nextCursor)
      })
      .catch((err) => {
        console.error('loadMergedReports failed', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [buildOpts])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    void loadMergedReports(buildOpts(nextCursor))
      .then((result) => {
        setReports((prev) => [...prev, ...result.cards])
        if (result.photosByReportId) {
          setPhotosByReportId((prev) => {
            const next = new Map(prev)
            for (const [k, v] of result.photosByReportId!) next.set(k, v)
            return next
          })
        }
        setHasMore(result.hasMore)
        setNextCursor(result.nextCursor)
      })
      .catch((err) => console.error('loadMore failed', err))
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore, buildOpts])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload зависит от filtersKey, второго триггера не нужно
  }, [filtersKey])

  const updateFilters = useCallback(
    (patch: Partial<ParsedFilters>) => {
      setSearchParams(serializeFilters({ ...filters, ...patch }), {
        replace: true,
      })
    },
    [filters, setSearchParams],
  )

  const openReport = useCallback(
    (id: string) => {
      const qs = searchParams.toString()
      navigate(qs ? `/reports/${id}?${qs}` : `/reports/${id}`)
    },
    [navigate, searchParams],
  )

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

  // Клиентский фильтр — страховочный слой для local draft'ов и
  // оффлайн-кэша; серверный ответ уже отфильтрован.
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
          onChange={(v) => updateFilters({ viewMode: v as ViewMode })}
          options={[
            { label: reportsList.viewByDate, value: 'date' },
            { label: reportsList.viewByPerformer, value: 'performer' },
            { label: reportsList.viewByPhotos, value: 'photos' },
          ]}
        />
        <Select
          allowClear
          placeholder={reportsList.filterProjectAll}
          style={{ minWidth: 200 }}
          value={projectId ?? undefined}
          onChange={(v) => updateFilters({ projectId: v ?? null })}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          getPopupContainer={() => document.body}
        />
        <Space size={6} wrap>
          {monthOptions.map((m) => (
            <Tag.CheckableTag
              key={m.key}
              checked={selectedMonths.includes(m.key)}
              onChange={(checked) => {
                const next = checked
                  ? [...selectedMonths, m.key]
                  : selectedMonths.filter((x) => x !== m.key)
                updateFilters({ selectedMonths: next })
              }}
            >
              {m.label}
            </Tag.CheckableTag>
          ))}
        </Space>
        <DatePicker.RangePicker
          value={range as never}
          onChange={(v) =>
            updateFilters({
              range:
                v && (v[0] || v[1])
                  ? (v as [Dayjs | null, Dayjs | null])
                  : null,
            })
          }
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
          onChange={(v) => updateFilters({ workTypeIds: v })}
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={workTypes.map((w) => ({ value: w.id, label: w.name }))}
          maxTagCount="responsive"
          getPopupContainer={() => document.body}
        />
        {hasFilters && (
          <Button
            onClick={() =>
              setSearchParams(
                serializeFilters({
                  projectId: null,
                  selectedMonths: [],
                  range: null,
                  workTypeIds: [],
                  viewMode,
                }),
                { replace: true },
              )
            }
          >
            {reportsList.filterReset}
          </Button>
        )}
      </Flex>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : viewMode === 'photos' ? (
        <PhotoFeedView
          reports={filtered}
          photosByReportId={photosByReportId}
          projectsById={projectsById}
          workTypesById={workTypesById}
          performersById={performersById}
          workAssignmentsById={workAssignmentsById}
          searchQuery={searchParams.toString()}
        />
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

      {hasMore && !loading && viewMode !== 'photos' && filtered.length > 0 && (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button onClick={loadMore} loading={loadingMore}>
            Загрузить ещё
          </Button>
        </Flex>
      )}
    </>
  )
}
