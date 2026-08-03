import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Result, Skeleton, Space, Typography } from 'antd'
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, reportDetails } from '@/shared/i18n/ru'
import { getDB, type ReportMutation, type SyncIssue, type SyncOp } from '@/lib/db'
import { deleteRemoteReport, purgeLocalReportData } from '@/services/reports'
import { emitReportChanged, emitReportsChanged, onReportsChanged } from '@/services/invalidation'
import { ackSyncIssuesForReport, listSyncIssuesForReport } from '@/services/syncIssues'
import { retryReport } from '@/services/sync'
import { EditReportModal, type EditReportSaveInput, type ExistingPhoto } from './components/EditReportModal'
import { Photo360Viewer } from './components/Photo360Viewer'
import { ReplaceBlockedCatalogModal } from './components/ReplaceBlockedCatalogModal'
import { ReportDetailsHeader } from './components/ReportDetailsHeader'
import { ReportMetaCard } from './components/ReportMetaCard'
import { ReportPhotosCard } from './components/ReportPhotosCard'
import { ReportPlanCard } from './components/ReportPlanCard'
import type { PlanMarkValue } from './components/PlanMarkPicker'
import { useAuth } from '@/app/providers/AuthProvider'
import { useReportData } from './hooks/useReportData'
import { useReportCatalogs } from './hooks/useReportCatalogs'
import { usePlanBlob } from './hooks/usePlanBlob'
import { useReportPhotos } from './hooks/useReportPhotos'
import { saveReport } from './lib/saveReport'
import { SYNC_STATUS_LABEL } from './lib/syncStatusLabel'

export function ReportDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { message } = App.useApp()

  // Возврат на список с теми же фильтрами/режимом, что были при открытии
  // отчёта. URL уже содержит query (мы сохранили его в openReport на /reports),
  // поэтому он переживает и F5, и нативную браузерную Back.
  const backToList = useCallback(() => {
    const qs = searchParams.toString()
    navigate(qs ? `/reports?${qs}` : '/reports')
  }, [navigate, searchParams])

  const { data, loading, error, offlineUnavailable, refresh } = useReportData(id, user, profile)
  const { projects, workTypes, performers, workAssignments, plans, setWorkTypes, setWorkAssignments } =
    useReportCatalogs(data?.card.projectId)
  // Точки отчёта могут стоять на разных планах и страницах, поэтому какой план
  // открыт — состояние страницы, а не производная от метки.
  const [viewPlanId, setViewPlanId] = useState<string | null>(null)
  const [viewPage, setViewPage] = useState(1)
  const { planBlob, planError, planCachedOffline } = usePlanBlob(
    viewPlanId ?? data?.mark?.planId ?? data?.card.planId ?? null,
    plans,
  )
  const { localDisplayPhotos, remotePhotoUrls, remotePhotosLoading } = useReportPhotos(data)

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pano360Src, setPano360Src] = useState<string | null>(null)
  const [issues, setIssues] = useState<SyncIssue[]>([])
  const [retrying, setRetrying] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)

  // Блокировка справочником показывается отдельным алертом: она восстановима и
  // имеет собственное действие, тогда как остальные issue — про потерянные правки.
  const blockedIssue = issues.find((i) => i.kind === 'dict_blocked') ?? null
  const otherIssues = issues.filter((i) => i.kind !== 'dict_blocked')

  useEffect(() => {
    if (!id) return
    let alive = true
    const refresh = () => {
      listSyncIssuesForReport(id)
        .then((list) => { if (alive) setIssues(list) })
        .catch(() => undefined)
    }
    refresh()
    const unsub = onReportsChanged(refresh)
    return () => {
      alive = false
      unsub()
    }
  }, [id])

  const handleAckIssues = useCallback(async () => {
    if (!id) return
    await ackSyncIssuesForReport(id)
    setIssues([])
    refresh()
  }, [id, refresh])

  const handleRetry = useCallback(async () => {
    if (!id) return
    setRetrying(true)
    try {
      const found = await retryReport(id)
      if (!found) {
        message.info('Очередь синхронизации для этого отчёта пуста — нечего повторять.')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRetrying(false)
    }
  }, [id, message])

  // Подготовка данных для EditReportModal
  const existingPhotosForModal = useMemo<ExistingPhoto[]>(() => {
    if (data?.localPhotos) {
      return localDisplayPhotos.map((p) => {
        const local = data.localPhotos!.find((lp) => lp.id === p.id)
        return {
          id: p.id,
          thumbUrl: p.thumbUrl,
          objectKey: local?.objectKey ?? '',
          thumbObjectKey: local?.thumbObjectKey ?? '',
          width: local?.width ?? p.width,
          height: local?.height ?? p.height,
        }
      })
    }
    if (data?.remotePhotos) {
      return remotePhotoUrls.map((p) => {
        const remote = data.remotePhotos!.find((rp) => rp.id === p.id)
        return {
          id: p.id,
          thumbUrl: p.thumbUrl,
          objectKey: remote?.object_key ?? '',
          thumbObjectKey: remote?.thumb_object_key ?? '',
          width: remote?.width ?? p.width,
          height: remote?.height ?? p.height,
        }
      })
    }
    return []
  }, [data?.localPhotos, data?.remotePhotos, localDisplayPhotos, remotePhotoUrls])

  const existingMarkForModal = useMemo<PlanMarkValue | null>(() => {
    if (!data?.mark) return null
    return {
      planId: data.mark.planId,
      page: data.mark.page,
      xNorm: data.mark.xNorm,
      yNorm: data.mark.yNorm,
    }
  }, [data?.mark])

  const canEdit = Boolean(
    data &&
    (data.card.syncStatus === 'synced' || data.card.remoteOnly) &&
    (profile?.role === 'admin' || data.card.authorId === user?.id),
  )
  const canShowEditDisabled = Boolean(
    !canEdit && data && !(data.card.syncStatus === 'synced' || data.card.remoteOnly),
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
          backToList()
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
      backToList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }, [id, data, backToList, message])

  const handleSave = useCallback(async (values: EditReportSaveInput) => {
    if (!id || !data) return
    setEditLoading(true)
    try {
      const result = await saveReport({
        id,
        data,
        values,
        existingPhotos: existingPhotosForModal,
      })
      if (result.kind === 'conflict') {
        message.warning(result.message)
        refresh()
        return
      }
      if (result.kind === 'queued') {
        message.info(reportDetails.editSavedLocally)
        setEditOpen(false)
        emitReportChanged(id, 'update')
        return
      }
      message.success(reportDetails.editSuccess)
      setEditOpen(false)
      emitReportChanged(id, 'update')
      emitReportsChanged()
      refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditLoading(false)
    }
  }, [id, data, message, existingPhotosForModal, refresh])

  if (!id) return <Result status="404" title={reportDetails.notFound} />

  if (loading) {
    return (
      <>
        <PageHeader
          title={reportDetails.title}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={backToList}>
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
            <Button icon={<ArrowLeftOutlined />} onClick={backToList}>
              {actions.back}
            </Button>
          }
        />
        <Result status="warning" title="Отчёт недоступен офлайн" subTitle={reportDetails.offlineWarning} />
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title={reportDetails.title}
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={backToList}>
              {actions.back}
            </Button>
          }
        />
        <Result status="error" title={error ?? reportDetails.notFound} />
      </>
    )
  }

  const plan =
    plans.find((p) => p.id === data.mark?.planId) ?? plans.find((p) => p.id === data.card.planId)
  const status = SYNC_STATUS_LABEL[data.card.syncStatus]
  const photos = data.localPhotos ? localDisplayPhotos : remotePhotoUrls
  const expectedPhotos = data.remotePhotos?.length ?? 0

  return (
    <>
      <ReportDetailsHeader
        canEdit={canEdit}
        canShowEditDisabled={canShowEditDisabled}
        deleting={deleting}
        onEdit={() => setEditOpen(true)}
        onDelete={handleDelete}
        onBack={backToList}
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {blockedIssue && (
          <Alert
            type="warning"
            showIcon
            message="Отчёт ждёт справочника"
            description={
              <>
                <div>{blockedIssue.message}</div>
                <Typography.Text type="secondary">
                  Данные отчёта сохранены. Он уйдёт сам, как только администратор
                  добавит или вернёт позицию — либо выберите другую вручную.
                </Typography.Text>
              </>
            }
            action={
              <Space direction="vertical" size={4}>
                {blockedIssue.catalogKind && blockedIssue.catalogId && (
                  <Button size="small" type="primary" onClick={() => setReplaceOpen(true)}>
                    {blockedIssue.catalogKind === 'work_type'
                      ? 'Заменить вид работ'
                      : 'Заменить назначение'}
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={retrying}
                  onClick={handleRetry}
                >
                  Повторить
                </Button>
              </Space>
            }
          />
        )}
        {otherIssues.length > 0 && (
          <Alert
            type={otherIssues.some((i) => i.kind === 'conflict') ? 'warning' : 'error'}
            showIcon
            message={
              otherIssues[0].kind === 'conflict'
                ? 'Изменения отменены: версия отчёта на сервере новее'
                : 'Не удалось синхронизировать изменения'
            }
            description={
              <>
                {otherIssues.slice(0, 3).map((i) => (
                  <div key={i.id ?? i.detectedAt}>{i.message}</div>
                ))}
              </>
            }
            action={
              <Space direction="vertical" size={4}>
                <Button size="small" type="primary" onClick={handleAckIssues}>
                  Понятно
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={retrying}
                  onClick={handleRetry}
                >
                  Повторить
                </Button>
              </Space>
            }
          />
        )}
        {data.card.syncStatus === 'failed' && issues.length === 0 && (
          <Alert
            type="error"
            showIcon
            message="Отчёт не синхронизирован"
            description={data.card.lastError ?? 'Ошибка синхронизации'}
            action={
              <Button size="small" icon={<ReloadOutlined />} loading={retrying} onClick={handleRetry}>
                Повторить
              </Button>
            }
          />
        )}
        {data.card.remoteOnly && (
          <Alert type="info" showIcon message={reportDetails.remoteOnlyInfo} />
        )}

        <ReportMetaCard
          data={data}
          projects={projects}
          workTypes={workTypes}
          performers={performers}
          workAssignments={workAssignments}
          status={status}
        />

        <ReportPhotosCard
          photos={photos}
          expectedCount={expectedPhotos}
          remotePhotosLoading={remotePhotosLoading}
          onPanoClick={setPano360Src}
        />

        <ReportPlanCard
          data={data}
          plans={plans}
          viewPlanId={viewPlanId ?? data.mark?.planId ?? data.card.planId ?? null}
          viewPage={viewPage}
          onViewPlanChange={(pid) => {
            setViewPlanId(pid)
            setViewPage(1)
          }}
          onViewPageChange={setViewPage}
          onPointClick={(photoId) => {
            const photo = photos.find((ph) => ph.id === photoId)
            if (photo) setPano360Src(photo.fullUrl)
          }}
          plan={plan}
          planBlob={planBlob}
          planError={planError}
          planCachedOffline={planCachedOffline}
        />
      </Space>

      <EditReportModal
        open={editOpen}
        report={data.card}
        workTypes={workTypes}
        performers={performers}
        workAssignments={workAssignments}
        plans={plans}
        existingPhotos={existingPhotosForModal}
        existingMark={existingMarkForModal}
        existingPhotoMarks={data.photoMarks}
        loading={editLoading}
        onSave={handleSave}
        onCancel={() => setEditOpen(false)}
        onWorkTypeCreated={(wt) => setWorkTypes((prev) => [...prev, wt])}
        onWorkAssignmentCreated={(wa) => setWorkAssignments((prev) => [...prev, wa])}
      />

      <ReplaceBlockedCatalogModal
        open={replaceOpen}
        catalogKind={blockedIssue?.catalogKind ?? null}
        oldId={blockedIssue?.catalogId ?? null}
        message={blockedIssue?.message ?? null}
        workTypes={workTypes}
        workAssignments={workAssignments}
        onCancel={() => setReplaceOpen(false)}
        onDone={() => {
          setReplaceOpen(false)
          void refresh()
        }}
      />

      <Photo360Viewer
        open={pano360Src !== null}
        src={pano360Src}
        onClose={() => setPano360Src(null)}
      />
    </>
  )
}
