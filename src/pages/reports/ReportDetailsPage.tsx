import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Image,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, reportDetails } from '@/shared/i18n/ru'
import type { LocalPhoto, SyncStatus } from '@/lib/db'
import { getDB } from '@/lib/db'
import { getLocalReport, getPhotosForReport } from '@/services/localReports'
import {
  loadRemoteReportById,
  type ReportCard,
  type RemoteReportFull,
  type RemoteReportPhoto,
} from '@/services/reports'
import { loadPlansForProject, loadProjectsForUser, loadWorkTypes, loadPerformers, type PlanRow } from '@/services/catalogs'
import { requestPresigned } from '@/services/r2'
import { useAuth } from '@/app/providers/AuthProvider'
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

interface DisplayPhoto {
  id: string
  thumbUrl: string
  fullUrl: string
}

interface LoadedReport {
  card: ReportCard
  localPhotos: LocalPhoto[] | null
  remotePhotos: RemoteReportPhoto[] | null
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null
  authorName: string | null
}

export function ReportDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<LoadedReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offlineUnavailable, setOfflineUnavailable] = useState(false)

  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [performers, setPerformers] = useState<Performer[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [planCachedOffline, setPlanCachedOffline] = useState(false)

  const [remotePhotoUrls, setRemotePhotoUrls] = useState<DisplayPhoto[]>([])
  const objectUrlsRef = useRef<string[]>([])

  // Загрузка отчёта
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setOfflineUnavailable(false)

    const run = async () => {
      try {
        const local = await getLocalReport(id)
        if (local) {
          const photos = await getPhotosForReport(local.id)
          const db = await getDB()
          const mark = await db.get('plan_marks', local.id)
          if (cancelled) return
          setData({
            card: {
              id: local.id,
              projectId: local.projectId,
              workTypeId: local.workTypeId,
              performerId: local.performerId,
              planId: local.planId,
              description: local.description,
              takenAt: local.takenAt,
              authorId: local.authorId,
              createdAt: local.createdAt,
              syncStatus: local.syncStatus,
              remoteOnly: false,
            },
            localPhotos: photos,
            remotePhotos: null,
            mark: mark
              ? { planId: mark.planId, page: mark.page, xNorm: mark.xNorm, yNorm: mark.yNorm }
              : null,
            authorName: local.authorId === user?.id ? profile?.full_name ?? null : null,
          })
          setLoading(false)
          return
        }

        const online = typeof navigator === 'undefined' ? true : navigator.onLine
        if (!online) {
          if (cancelled) return
          setOfflineUnavailable(true)
          setLoading(false)
          return
        }

        const remote: RemoteReportFull | null = await loadRemoteReportById(id)
        if (cancelled) return
        if (!remote) {
          setError(reportDetails.notFound)
          setLoading(false)
          return
        }
        setData({
          card: remote.card,
          localPhotos: null,
          remotePhotos: remote.photos,
          mark: remote.mark
            ? {
                planId: remote.mark.plan_id,
                page: remote.mark.page,
                xNorm: remote.mark.x_norm,
                yNorm: remote.mark.y_norm,
              }
            : null,
          authorName: remote.authorName,
        })
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id, user?.id, profile?.full_name])

  // Справочники для имён
  useEffect(() => {
    void loadProjectsForUser().then(setProjects).catch(() => undefined)
    void loadWorkTypes().then(setWorkTypes).catch(() => undefined)
    void loadPerformers().then(setPerformers).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!data?.card.projectId) return
    void loadPlansForProject(data.card.projectId).then(setPlans).catch(() => undefined)
  }, [data?.card.projectId])

  // Проверка offline-кэша плана
  useEffect(() => {
    if (!data?.mark?.planId) {
      setPlanCachedOffline(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const db = await getDB()
        const cached = await db.get('plans_cache', data.mark!.planId)
        if (!cancelled) setPlanCachedOffline(Boolean(cached))
      } catch {
        if (!cancelled) setPlanCachedOffline(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data?.mark?.planId])

  // Локальные фото → object URLs
  const localDisplayPhotos = useMemo<DisplayPhoto[]>(() => {
    if (!data?.localPhotos) return []
    // Очищаем предыдущие
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
    objectUrlsRef.current = []
    const list = data.localPhotos.map((p) => {
      const thumbUrl = URL.createObjectURL(p.thumbBlob)
      const fullUrl = URL.createObjectURL(p.blob)
      objectUrlsRef.current.push(thumbUrl, fullUrl)
      return { id: p.id, thumbUrl, fullUrl }
    })
    return list
  }, [data?.localPhotos])

  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
      objectUrlsRef.current = []
    }
  }, [])

  // Remote-only фото → presigned GET
  useEffect(() => {
    if (!data?.remotePhotos) {
      setRemotePhotoUrls([])
      return
    }
    let cancelled = false
    void (async () => {
      const out: DisplayPhoto[] = []
      for (const p of data.remotePhotos!) {
        try {
          const [thumb, full] = await Promise.all([
            requestPresigned({
              op: 'get',
              kind: 'photo_thumb',
              key: p.thumb_r2_key,
              reportId: data.card.id,
            }),
            requestPresigned({
              op: 'get',
              kind: 'photo',
              key: p.r2_key,
              reportId: data.card.id,
            }),
          ])
          out.push({ id: p.id, thumbUrl: thumb.url, fullUrl: full.url })
        } catch {
          // пропускаем — будет placeholder
        }
      }
      if (!cancelled) setRemotePhotoUrls(out)
    })()
    return () => {
      cancelled = true
    }
  }, [data?.remotePhotos, data?.card.id])

  if (!id) return <Result status="404" title={reportDetails.notFound} />

  if (loading) {
    return (
      <>
        <PageHeader
          title={reportDetails.title}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
              {actions.back}
            </Button>
          }
        />
        <Skeleton active />
      </>
    )
  }

  if (offlineUnavailable) {
    return (
      <>
        <PageHeader
          title={reportDetails.title}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
              {actions.back}
            </Button>
          }
        />
        <Result
          status="warning"
          title="Отчёт недоступен офлайн"
          subTitle={reportDetails.offlineWarning}
        />
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title={reportDetails.title}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
              {actions.back}
            </Button>
          }
        />
        <Result status="error" title={error ?? reportDetails.notFound} />
      </>
    )
  }

  const projectName = projects.find((p) => p.id === data.card.projectId)?.name ?? '—'
  const workTypeName = workTypes.find((w) => w.id === data.card.workTypeId)?.name ?? '—'
  const performer = performers.find((p) => p.id === data.card.performerId)
  const plan = plans.find((p) => p.id === data.mark?.planId) ?? plans.find((p) => p.id === data.card.planId)
  const status = STATUS_LABEL[data.card.syncStatus]
  const photos = data.localPhotos ? localDisplayPhotos : remotePhotoUrls

  return (
    <>
      <PageHeader
        title={reportDetails.title}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
            {actions.back}
          </Button>
        }
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {data.card.remoteOnly && (
          <Alert type="info" showIcon message={reportDetails.remoteOnlyInfo} />
        )}

        <Card title={reportDetails.sectionMeta}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={reportDetails.project}>{projectName}</Descriptions.Item>
            <Descriptions.Item label={reportDetails.workType}>{workTypeName}</Descriptions.Item>
            <Descriptions.Item label={reportDetails.performer}>
              {performer
                ? `${performer.name} · ${
                    performer.kind === 'contractor'
                      ? reportDetails.performerContractor
                      : reportDetails.performerOwn
                  }`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.description}>
              {data.card.description || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.takenAt}>
              {data.card.takenAt
                ? dayjs(data.card.takenAt).format('DD.MM.YYYY HH:mm')
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.createdAt}>
              {dayjs(data.card.createdAt).format('DD.MM.YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.author}>
              {data.authorName ?? data.card.authorId}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.syncStatus}>
              <Tag color={status.color}>{status.text}</Tag>
              {data.card.remoteOnly && (
                <Tag color="default">{/* remoteTag */}С сервера</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title={reportDetails.sectionPhotos}>
          {photos.length === 0 ? (
            <Typography.Text type="secondary">
              {data.remotePhotos && data.remotePhotos.length > 0
                ? reportDetails.photoUnavailable
                : reportDetails.noPhotos}
            </Typography.Text>
          ) : (
            <Image.PreviewGroup>
              <Space wrap size={8}>
                {photos.map((p) => (
                  <Image
                    key={p.id}
                    src={p.thumbUrl}
                    preview={{ src: p.fullUrl }}
                    width={120}
                    height={120}
                    style={{ objectFit: 'cover', borderRadius: 6 }}
                    fallback="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="
                  />
                ))}
              </Space>
            </Image.PreviewGroup>
          )}
        </Card>

        <Card title={reportDetails.sectionPlan}>
          {data.mark ? (
            <Space direction="vertical" size={6}>
              <Typography.Text strong>{plan?.name ?? '—'}</Typography.Text>
              <Typography.Text>
                {reportDetails.pageLabel} {data.mark.page} · {reportDetails.point}{' '}
                {(data.mark.xNorm * 100).toFixed(1)}% × {(data.mark.yNorm * 100).toFixed(1)}%
              </Typography.Text>
              {planCachedOffline && <Tag color="green">{reportDetails.planOffline}</Tag>}
            </Space>
          ) : (
            <Typography.Text type="secondary">{reportDetails.noMark}</Typography.Text>
          )}
        </Card>
      </Space>
    </>
  )
}
