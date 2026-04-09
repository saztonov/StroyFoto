import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  DatePicker,
  Empty,
  Flex,
  Input,
  List,
  Select,
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

export function ReportsListPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState<ReportCard[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])

  const [projectId, setProjectId] = useState<string | null>(null)
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [workTypeQuery, setWorkTypeQuery] = useState('')

  const reload = () => {
    void loadMergedReports().then(setReports)
  }

  useEffect(() => {
    reload()
    void loadProjectsForUser().then(setProjects).catch(() => undefined)
    void loadWorkTypes().then(setWorkTypes).catch(() => undefined)
    const unsub = subscribeSync(() => reload())
    return () => {
      unsub()
    }
  }, [])

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

      {filtered.length === 0 ? (
        <Empty
          description={
            reports.length === 0 ? reportsList.emptyLocal : reportsList.emptyFiltered
          }
        />
      ) : (
        <List
          dataSource={filtered}
          renderItem={(r) => {
            const s = STATUS_LABEL[r.syncStatus]
            const project = projectsById.get(r.projectId)
            const workType = workTypesById.get(r.workTypeId)
            return (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/reports/${r.id}`)}
              >
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Badge
                        status={r.syncStatus === 'synced' ? 'success' : 'processing'}
                      />
                      <Typography.Text strong>
                        {project?.name ?? '—'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')}
                      </Typography.Text>
                    </Space>
                  }
                  description={
                    <Space size={8} wrap>
                      <Tag color={s.color}>{s.text}</Tag>
                      {r.remoteOnly && <Tag color="default">{reportsList.remoteTag}</Tag>}
                      {workType && (
                        <Typography.Text type="secondary">{workType.name}</Typography.Text>
                      )}
                      {r.description && (
                        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
                          {r.description}
                        </Typography.Text>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )
          }}
        />
      )}
    </>
  )
}
