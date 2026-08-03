import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, DatePicker, Divider, Form, Input, Modal, Typography } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { type ReportCard, reportPerformerIds } from '@/services/reports'
import type { PlanRow } from '@/services/catalogs'
import type { DraftPhoto } from './PhotoPicker'
import type { PlanMarkValue, PlanMarksValue } from './PlanMarkPicker'
import type { LocalPhotoMark } from '@/lib/db'
import { actions, reportDetails } from '@/shared/i18n/ru'
import { useIsDesktop } from '@/shared/hooks/useBreakpoint'
import { WorkTypeSelect } from './WorkTypeSelect'
import { WorkAssignmentSelect } from './WorkAssignmentSelect'
import { PerformerSelect } from './PerformerSelect'
import { PhotoPicker } from './PhotoPicker'
import { panoramaOnly, useBlobUrls } from '../lib/markablePhotos'
import { PlanMarkPicker } from './PlanMarkPicker'

/** Существующая фотография отчёта (уже на сервере или в IDB) */
export interface ExistingPhoto {
  id: string
  thumbUrl: string
  objectKey: string
  thumbObjectKey: string
  // Размеры нужны, чтобы отличить сферический снимок от обычного при
  // редактировании: точку принимают только панорамы.
  width: number | null
  height: number | null
}

/** Результат редактирования — полный набор изменений */
export interface EditReportSaveInput {
  workTypeId: string
  /** Основной подрядчик — первый элемент performerIds. */
  performerId: string
  performerIds: string[]
  workAssignmentId: string
  description: string | null
  takenAt: string | null
  planId: string | null | undefined // undefined = не менять
  photosToRemove: Array<{ id: string; objectKey: string; thumbObjectKey: string }>
  photosToAdd: DraftPhoto[]
  mark: PlanMarkValue | null | undefined // undefined = не менять
  markChanged: boolean
  /** undefined = набор не трогать. Отдельный флаг: правка описания не должна
   *  слать replace-all и ловить лишний OCC-конфликт. */
  photoMarks: LocalPhotoMark[] | undefined
  photoMarksChanged: boolean
}

interface Props {
  open: boolean
  report: ReportCard
  workTypes: WorkType[]
  performers: Performer[]
  workAssignments: WorkAssignment[]
  plans: PlanRow[]
  existingPhotos: ExistingPhoto[]
  existingMark: PlanMarkValue | null
  existingPhotoMarks: LocalPhotoMark[]
  loading?: boolean
  onSave: (values: EditReportSaveInput) => Promise<void>
  onCancel: () => void
  onWorkTypeCreated?: (wt: WorkType) => void
  onWorkAssignmentCreated?: (wa: WorkAssignment) => void
}

export function EditReportModal({
  open,
  report,
  workTypes,
  performers,
  workAssignments,
  plans,
  existingPhotos,
  existingMark,
  existingPhotoMarks,
  loading,
  onSave,
  onCancel,
  onWorkTypeCreated,
  onWorkAssignmentCreated,
}: Props) {
  const { message } = App.useApp()
  const isDesktop = useIsDesktop()

  // Справочники приходят только с активными позициями. Если отчёт исторический
  // и его позиция уже в архиве, селект показал бы пустое обязательное поле.
  // Подмешиваем текущую позицию по имени с сервера — значение при этом не
  // меняется, поэтому серверная проверка активности его пропускает.
  const workTypeOptions = useMemo(() => {
    if (!report.workTypeId || workTypes.some((w) => w.id === report.workTypeId)) return workTypes
    if (!report.workTypeName) return workTypes
    return [
      ...workTypes,
      {
        id: report.workTypeId,
        name: `${report.workTypeName} (архив)`,
        is_active: false,
        created_by: null,
        created_at: '',
      } as WorkType,
    ]
  }, [workTypes, report.workTypeId, report.workTypeName])

  const workAssignmentOptions = useMemo(() => {
    if (!report.workAssignmentId || workAssignments.some((w) => w.id === report.workAssignmentId)) {
      return workAssignments
    }
    if (!report.workAssignmentName) return workAssignments
    return [
      ...workAssignments,
      {
        id: report.workAssignmentId,
        name: `${report.workAssignmentName} (архив)`,
        is_active: false,
        created_by: null,
        created_at: '',
      } as WorkAssignment,
    ]
  }, [workAssignments, report.workAssignmentId, report.workAssignmentName])
  const [form] = Form.useForm<{
    workTypeId: string
    performerIds: string[]
    workAssignmentId: string
    description: string
    takenAt: dayjs.Dayjs | null
  }>()

  // Фото: какие из существующих удалены, какие новые добавлены
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [newPhotos, setNewPhotos] = useState<DraftPhoto[]>([])

  // Сферические снимки для ленты: оставшиеся существующие плюс новые.
  const newThumbUrls = useBlobUrls(
    useMemo(() => newPhotos.map((p) => ({ id: p.id, blob: p.thumbBlob })), [newPhotos]),
  )
  const markablePhotos = useMemo(
    () =>
      panoramaOnly([
        ...existingPhotos
          .filter((p) => !removedIds.has(p.id))
          .map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, width: p.width, height: p.height })),
        ...newPhotos.map((p) => ({
          id: p.id,
          thumbUrl: newThumbUrls.get(p.id) ?? '',
          width: p.width,
          height: p.height,
        })),
      ]),
    [existingPhotos, removedIds, newPhotos, newThumbUrls],
  )


  // План и метка
  const [marks, setMarks] = useState<PlanMarksValue>({
    reportPlanId: null,
    legacyMark: null,
    photoMarks: [],
  })
  // Флаги раздельные: общая метка, набор точек и план отчёта меняются независимо.
  const [markDirty, setMarkDirty] = useState(false)
  const [photoMarksDirty, setPhotoMarksDirty] = useState(false)

  // Инициализация при открытии
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        workTypeId: report.workTypeId,
        performerIds: reportPerformerIds(report),
        workAssignmentId: report.workAssignmentId ?? '',
        description: report.description ?? '',
        takenAt: report.takenAt ? dayjs(report.takenAt) : null,
      })
      setRemovedIds(new Set())
      setNewPhotos([])
      setMarks({
        reportPlanId: existingMark?.planId ?? report.planId ?? null,
        legacyMark: existingMark,
        photoMarks: existingPhotoMarks,
      })
      setMarkDirty(false)
      setPhotoMarksDirty(false)
    }
  }, [open, report, existingMark, existingPhotoMarks, form])

  // Фильтруем существующие фото, исключая удалённые
  const visibleExisting = useMemo(
    () => existingPhotos.filter((p) => !removedIds.has(p.id)),
    [existingPhotos, removedIds],
  )

  const totalPhotos = visibleExisting.length + newPhotos.length

  const handleRemoveExisting = useCallback((id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const handleMarksChange = useCallback((next: PlanMarksValue) => {
    setMarks((prev) => {
      if (prev.legacyMark !== next.legacyMark || prev.reportPlanId !== next.reportPlanId) {
        setMarkDirty(true)
      }
      if (prev.photoMarks !== next.photoMarks) setPhotoMarksDirty(true)
      return next
    })
  }, [])

  const handleOk = async () => {
    // Валидация: минимум 1 фото
    if (totalPhotos < 1) {
      message.warning(reportDetails.editMinOnePhoto)
      return
    }
    try {
      const values = await form.validateFields()

      const photosToRemove = existingPhotos
        .filter((p) => removedIds.has(p.id))
        .map((p) => ({ id: p.id, objectKey: p.objectKey, thumbObjectKey: p.thumbObjectKey }))

      // planId: если метка изменена — берём planId из mark; иначе undefined (не менять)
      let planId: string | null | undefined = undefined
      if (markDirty) {
        planId = marks.reportPlanId
      }

      await onSave({
        workTypeId: values.workTypeId,
        performerId: values.performerIds[0],
        performerIds: values.performerIds,
        workAssignmentId: values.workAssignmentId,
        description: values.description?.trim() || null,
        takenAt: values.takenAt?.toISOString() ?? null,
        planId,
        photosToRemove,
        photosToAdd: newPhotos,
        mark: markDirty ? marks.legacyMark : undefined,
        markChanged: markDirty,
        photoMarks: photoMarksDirty ? marks.photoMarks : undefined,
        photoMarksChanged: photoMarksDirty,
      })
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      throw e
    }
  }

  return (
    <Modal
      title={reportDetails.editTitle}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={actions.save}
      cancelText={actions.cancel}
      confirmLoading={loading}
      destroyOnHidden
      width={isDesktop ? 720 : '100vw'}
      style={isDesktop ? { top: 20 } : { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 }}
      styles={
        isDesktop
          ? undefined
          : {
              body: {
                maxHeight: 'calc(100dvh - 110px)',
                overflowY: 'auto',
                paddingInline: 16,
              },
            }
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="workTypeId"
          label={reportDetails.workType}
          rules={[{ required: true, message: 'Выберите вид работ' }]}
        >
          <WorkTypeSelect
            options={workTypeOptions}
            onCreated={(wt) => onWorkTypeCreated?.(wt)}
          />
        </Form.Item>
        <Form.Item
          name="workAssignmentId"
          label={reportDetails.workAssignment}
          rules={[{ required: true, message: 'Выберите назначение работ' }]}
        >
          <WorkAssignmentSelect
            options={workAssignmentOptions}
            onCreated={(wa) => onWorkAssignmentCreated?.(wa)}
          />
        </Form.Item>
        <Form.Item
          name="performerIds"
          label={reportDetails.performer}
          rules={[
            {
              required: true,
              type: 'array',
              min: 1,
              message: 'Выберите хотя бы одного исполнителя',
            },
          ]}
        >
          <PerformerSelect options={performers} />
        </Form.Item>
        <Form.Item name="description" label={reportDetails.description}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item name="takenAt" label={reportDetails.takenAt}>
          <DatePicker
            showTime
            format="DD.MM.YYYY HH:mm"
            style={{ width: '100%' }}
            getPopupContainer={() => document.body}
          />
        </Form.Item>
      </Form>

      {/* ---- Фотографии ---- */}
      <Divider />
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {reportDetails.editSectionPhotos}
      </Typography.Title>

      {visibleExisting.length > 0 && (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {reportDetails.editExistingPhotos}
          </Typography.Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {visibleExisting.map((p) => (
              <div
                key={p.id}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--ant-color-fill-quaternary)',
                }}
              >
                <img
                  src={p.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemoveExisting(p.id)}
                  disabled={totalPhotos <= 1}
                  style={{ position: 'absolute', top: 4, right: 4, minWidth: 32, minHeight: 32 }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        {reportDetails.editAddPhotos}
      </Typography.Text>
      <PhotoPicker value={newPhotos} onChange={setNewPhotos} />

      {totalPhotos < 1 && (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>
          {reportDetails.editMinOnePhoto}
        </Typography.Text>
      )}

      {/* ---- План и метка ---- */}
      {plans.length > 0 && (
        <>
          <Divider />
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {reportDetails.editSectionPlan}
          </Typography.Title>
          <PlanMarkPicker
            plans={plans}
            photos={markablePhotos}
            value={marks}
            onChange={handleMarksChange}
          />
        </>
      )}
    </Modal>
  )
}
