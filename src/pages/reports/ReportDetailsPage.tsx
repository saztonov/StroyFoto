import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Image,
  Popconfirm,
  Result,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, reportDetails } from '@/shared/i18n/ru'
import type { LocalPhoto, SyncStatus, ReportMutation, SyncOp } from '@/lib/db'
import { getDB } from '@/lib/db'
import { getLocalReport, getPhotosForReport } from '@/services/localReports'
import {
  cacheRemotePhotoBlob,
  ConflictError,
  deleteRemoteReport,
  getCachedRemotePhotoBlob,
  loadCachedRemoteReport,
  loadRemoteReportById,
  purgeLocalReportData,
  updateRemoteReport,
  type ReportCard,
  type ReportUpdateInput,
  type RemoteReportFull,
  type RemoteReportPhoto,
} from '@/services/reports'
import { loadPlansForProject, loadProjectsForUser, loadWorkTypes, loadPerformers, type PlanRow } from '@/services/catalogs'
import { requestPresigned } from '@/services/r2'
import { downloadPlanPdf, planDisplayName, type PlanRecord } from '@/services/plans'
import { emitReportChanged, emitReportsChanged, onReportChanged } from '@/services/invalidation'
import { triggerSync } from '@/services/sync'
import { PdfPlanCanvas } from './components/PdfPlanCanvas'
import { EditReportModal } from './components/EditReportModal'
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
  const { message } = App.useApp()

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

  const [planBlob, setPlanBlob] = useState<Blob | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)

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
              authorName: local.authorId === user?.id ? profile?.full_name ?? null : null,
              createdAt: local.createdAt,
              updatedAt: local.updatedAt ?? null,
              syncStatus: local.syncStatus,
              remoteOnly: false,
            },
            localPhotos: photos.filter((p) => p.origin !== 'remote'),
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
        let remote: RemoteReportFull | null = null
        if (online) {
          try {
            remote = await loadRemoteReportById(id)
            if (!remote) {
              // Онлайн-запрос успешен, но отчёт не найден → удалён другим
              // пользователем или доступ отозван. Чистим stale кэш.
              await purgeLocalReportData(id)
              if (cancelled) return
              setError('Отчёт удалён или недоступен')
              setLoading(false)
              return
            }
          } catch {
            // Сетевая ошибка — fallback на IDB-кэш
            remote = await loadCachedRemoteReport(id)
          }
        } else {
          // Офлайн — только кэш
          remote = await loadCachedRemoteReport(id)
        }
        if (cancelled) return
        if (!remote) {
          if (!online) setOfflineUnavailable(true)
          else setError(reportDetails.notFound)
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
  }, [id, user?.id, profile?.full_name, refreshCounter])

  // Подписка на изменения этого отчёта от других пользователей/вкладок
  useEffect(() => {
    if (!id) return
    const unsub = onReportChanged(id, (event) => {
      if (event === 'delete') {
        setError('Отчёт был удалён другим пользователем')
        setData(null)
      } else {
        // update — перезагружаем данные
        setRefreshCounter((c) => c + 1)
      }
    })
    return unsub
  }, [id])

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

  // Проверка offline-кэша плана + подгрузка blob для read-only PDF viewer.
  useEffect(() => {
    const targetPlanId = data?.mark?.planId ?? data?.card.planId
    if (!targetPlanId) {
      setPlanCachedOffline(false)
      setPlanBlob(null)
      setPlanError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const db = await getDB()
        const cached = await db.get('plans_cache', targetPlanId)
        if (!cancelled) setPlanCachedOffline(Boolean(cached))

        const planRow = plans.find((p) => p.id === targetPlanId)
        if (!planRow) {
          // нет метаданных плана → показать только координаты, blob не грузим
          if (!cancelled) setPlanBlob(null)
          return
        }
        const planRecord: PlanRecord = {
          id: planRow.id,
          project_id: planRow.project_id,
          name: planRow.name,
          floor: planRow.floor ?? null,
          building: planRow.building ?? null,
          section: planRow.section ?? null,
          r2_key: planRow.r2_key,
          page_count: planRow.page_count,
          uploaded_by: null,
          created_at: planRow.created_at,
          updated_at: planRow.created_at,
        }
        const b = await downloadPlanPdf(planRecord)
        if (!cancelled) setPlanBlob(b)
      } catch (e) {
        if (!cancelled) setPlanError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data?.mark?.planId, data?.card.planId, plans])

  // Локальные фото → object URLs
  const localDisplayPhotos = useMemo<DisplayPhoto[]>(() => {
    if (!data?.localPhotos) return []
    // Очищаем предыдущие
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
    objectUrlsRef.current = []
    const list = data.localPhotos.map((p) => {
      // thumbBlob может быть null для remote-кэша; тогда показываем полный blob как превью.
      const thumbUrl = URL.createObjectURL(p.thumbBlob ?? p.blob)
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

  // Remote-only фото: сначала пытаемся взять blob из IDB-кэша, иначе качаем
  // через presigned GET, кладём в IDB (origin='remote') и делаем object URL.
  // Такой порядок даёт honest offline: второе открытие отчёта работает без сети.
  useEffect(() => {
    if (!data?.remotePhotos) {
      setRemotePhotoUrls([])
      return
    }
    let cancelled = false
    const createdUrls: string[] = []
    void (async () => {
      const out: DisplayPhoto[] = []
      for (const p of data.remotePhotos!) {
        try {
          const cached = await getCachedRemotePhotoBlob(p.id)
          if (cached && cached.blob) {
            const thumbUrl = URL.createObjectURL(cached.thumbBlob ?? cached.blob)
            const fullUrl = URL.createObjectURL(cached.blob)
            createdUrls.push(thumbUrl, fullUrl)
            out.push({ id: p.id, thumbUrl, fullUrl })
            continue
          }
          const online = typeof navigator === 'undefined' ? true : navigator.onLine
          if (!online) continue

          const [thumbPre, fullPre] = await Promise.all([
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
          const [fullResp, thumbResp] = await Promise.all([
            fetch(fullPre.url),
            fetch(thumbPre.url),
          ])
          if (!fullResp.ok) throw new Error(`photo ${p.id}: ${fullResp.status}`)
          const fullBlob = await fullResp.blob()
          const thumbBlob = thumbResp.ok ? await thumbResp.blob() : null
          await cacheRemotePhotoBlob(data.card.id, p.id, fullBlob, thumbBlob)
          const thumbUrl = URL.createObjectURL(thumbBlob ?? fullBlob)
          const fullUrl = URL.createObjectURL(fullBlob)
          createdUrls.push(thumbUrl, fullUrl)
          out.push({ id: p.id, thumbUrl, fullUrl })
        } catch {
          // пропускаем — будет placeholder
        }
      }
      if (cancelled) {
        for (const u of createdUrls) URL.revokeObjectURL(u)
        return
      }
      setRemotePhotoUrls(out)
      objectUrlsRef.current.push(...createdUrls)
    })()
    return () => {
      cancelled = true
    }
  }, [data?.remotePhotos, data?.card.id])

  const canEdit = Boolean(
    data &&
    (data.card.syncStatus === 'synced' || data.card.remoteOnly) &&
    (profile?.role === 'admin' || data.card.authorId === user?.id),
  )

  const handleDelete = useCallback(async () => {
    if (!id || !data) return
    setDeleting(true)
    try {
      const online = typeof navigator === 'undefined' ? true : navigator.onLine
      if (online) {
        try {
          await deleteRemoteReport(id)
          await purgeLocalReportData(id)
          message.success(reportDetails.deleteSuccess)
          emitReportChanged(id, 'delete')
          emitReportsChanged()
          navigate('/reports')
          return
        } catch (e) {
          // Сетевая ошибка — ставим в offline-очередь
          if (!(e instanceof Error) || !/fetch|network|timeout/i.test(e.message)) {
            throw e
          }
        }
      }
      // Offline — ставим delete-мутацию в очередь
      const db = await getDB()
      const tx = db.transaction(['report_mutations', 'sync_queue'], 'readwrite')
      const mutation: ReportMutation = {
        kind: 'delete',
        reportId: id,
        baseUpdatedAt: data.card.updatedAt ?? data.card.createdAt,
        payload: null,
        queuedAt: Date.now(),
        lastError: null,
        attempts: 0,
        nextAttemptAt: Date.now(),
      }
      const mutationId = await tx.objectStore('report_mutations').add(mutation)
      const syncOp: SyncOp = {
        kind: 'report_delete',
        entityId: String(mutationId),
        reportId: id,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
      }
      await tx.objectStore('sync_queue').add(syncOp)
      await tx.done
      message.info('Удаление будет выполнено при восстановлении сети')
      emitReportsChanged()
      navigate('/reports')
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }, [id, data, navigate, message])

  const handleSave = useCallback(async (values: ReportUpdateInput) => {
    if (!id || !data) return
    setEditLoading(true)
    try {
      const online = typeof navigator === 'undefined' ? true : navigator.onLine
      if (online) {
        try {
          await updateRemoteReport(id, {
            ...values,
            expectedUpdatedAt: data.card.updatedAt,
          })
          message.success(reportDetails.editSuccess)
          setEditOpen(false)
          emitReportChanged(id, 'update')
          emitReportsChanged()
          setRefreshCounter((c) => c + 1)
          return
        } catch (e) {
          if (e instanceof ConflictError) {
            message.warning(e.message)
            setRefreshCounter((c) => c + 1)
            return
          }
          // Сетевая ошибка — ставим в offline-очередь
          if (!(e instanceof Error) || !/fetch|network|timeout/i.test(e.message)) {
            throw e
          }
        }
      }
      // Offline или сетевая ошибка — ставим мутацию в очередь
      const db = await getDB()
      const tx = db.transaction(['report_mutations', 'sync_queue'], 'readwrite')
      const mutation: ReportMutation = {
        kind: 'update',
        reportId: id,
        baseUpdatedAt: data.card.updatedAt ?? data.card.createdAt,
        payload: {
          workTypeId: values.workTypeId,
          performerId: values.performerId,
          description: values.description,
          takenAt: values.takenAt,
        },
        queuedAt: Date.now(),
        lastError: null,
        attempts: 0,
        nextAttemptAt: Date.now(),
      }
      const mutationId = await tx.objectStore('report_mutations').add(mutation)
      const syncOp: SyncOp = {
        kind: 'report_update',
        entityId: String(mutationId),
        reportId: id,
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
      }
      await tx.objectStore('sync_queue').add(syncOp)
      await tx.done
      message.info('Изменения сохранены локально и будут отправлены при восстановлении сети')
      setEditOpen(false)
      emitReportChanged(id, 'update')
      triggerSync()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditLoading(false)
    }
  }, [id, data, message])

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
          <Space size={8} wrap>
            {canEdit && (
              <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
                {actions.edit}
              </Button>
            )}
            {canEdit && (
              <Popconfirm
                title={reportDetails.deleteConfirmTitle}
                description={reportDetails.deleteConfirmContent}
                onConfirm={handleDelete}
                okText={actions.delete}
                cancelText={actions.cancel}
                okButtonProps={{ danger: true, loading: deleting }}
              >
                <Button danger icon={<DeleteOutlined />} loading={deleting}>
                  {actions.delete}
                </Button>
              </Popconfirm>
            )}
            {!canEdit && data && !(data.card.syncStatus === 'synced' || data.card.remoteOnly) && (
              <Tooltip title={reportDetails.cannotEditLocal}>
                <Button icon={<EditOutlined />} disabled>
                  {actions.edit}
                </Button>
              </Tooltip>
            )}
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
              {actions.back}
            </Button>
          </Space>
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
          {data.card.planId || data.mark ? (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Typography.Text strong>{plan ? planDisplayName(plan) : '—'}</Typography.Text>
              {data.mark && (
                <Typography.Text>
                  {reportDetails.pageLabel} {data.mark.page} · {reportDetails.point}{' '}
                  {(data.mark.xNorm * 100).toFixed(1)}% × {(data.mark.yNorm * 100).toFixed(1)}%
                </Typography.Text>
              )}
              {planCachedOffline && <Tag color="green">{reportDetails.planOffline}</Tag>}
              {planError && (
                <Typography.Text type="secondary">Не удалось открыть PDF: {planError}</Typography.Text>
              )}
              {planBlob && (
                <PdfPlanCanvas
                  blob={planBlob}
                  page={data.mark?.page ?? 1}
                  value={data.mark ? { xNorm: data.mark.xNorm, yNorm: data.mark.yNorm } : null}
                />
              )}
            </Space>
          ) : (
            <Typography.Text type="secondary">{reportDetails.noMark}</Typography.Text>
          )}
        </Card>
      </Space>

      {data && (
        <EditReportModal
          open={editOpen}
          report={data.card}
          workTypes={workTypes}
          performers={performers}
          loading={editLoading}
          onSave={handleSave}
          onCancel={() => setEditOpen(false)}
          onWorkTypeCreated={(wt) => setWorkTypes((prev) => [...prev, wt])}
        />
      )}
    </>
  )
}
