import { useCallback, useMemo, useState } from 'react'
import { Alert, App, Button, Result, Skeleton, Space } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, reportDetails } from '@/shared/i18n/ru'
import { getDB, type ReportMutation, type SyncOp } from '@/lib/db'
import { deleteRemoteReport, purgeLocalReportData } from '@/services/reports'
import { emitReportChanged, emitReportsChanged } from '@/services/invalidation'
import { EditReportModal, type EditReportSaveInput, type ExistingPhoto } from './components/EditReportModal'
import { Photo360Viewer } from './components/Photo360Viewer'
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
  const { user, profile } = useAuth()
  const { message } = App.useApp()

  const { data, loading, error, offlineUnavailable, refresh } = useReportData(id, user, profile)
  const { projects, workTypes, performers, workAssignments, plans, setWorkTypes, setWorkAssignments } =
    useReportCatalogs(data?.card.projectId)
  const { planBlob, planError, planCachedOffline } = usePlanBlob(
    data?.mark?.planId ?? data?.card.planId ?? null,
    plans,
  )
  const { localDisplayPhotos, remotePhotoUrls, remotePhotosLoading } = useReportPhotos(data)

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pano360Src, setPano360Src] = useState<string | null>(null)

  // Подготовка данных для EditReportModal
  const existingPhotosForModal = useMemo<ExistingPhoto[]>(() => {
    if (data?.localPhotos) {
      return localDisplayPhotos.map((p) => {
        const local = data.localPhotos!.find((lp) => lp.id === p.id)
        return {
          id: p.id,
          thumbUrl: p.thumbUrl,
          r2Key: local?.r2Key ?? '',
          thumbR2Key: local?.thumbR2Key ?? '',
          storage: 'cloudru',
        }
      })
    }
    if (data?.remotePhotos) {
      return remotePhotoUrls.map((p) => {
        const remote = data.remotePhotos!.find((rp) => rp.id === p.id)
        return {
          id: p.id,
          thumbUrl: p.thumbUrl,
          r2Key: remote?.r2_key ?? '',
          thumbR2Key: remote?.thumb_r2_key ?? '',
          storage: remote?.storage ?? 'cloudru',
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
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports')}>
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
        onBack={() => navigate('/reports')}
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
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
        loading={editLoading}
        onSave={handleSave}
        onCancel={() => setEditOpen(false)}
        onWorkTypeCreated={(wt) => setWorkTypes((prev) => [...prev, wt])}
        onWorkAssignmentCreated={(wa) => setWorkAssignments((prev) => [...prev, wa])}
      />

      <Photo360Viewer
        open={pano360Src !== null}
        src={pano360Src}
        onClose={() => setPano360Src(null)}
      />
    </>
  )
}
