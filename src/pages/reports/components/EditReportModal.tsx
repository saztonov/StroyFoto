import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, DatePicker, Divider, Form, Input, Modal, Typography } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import type { ReportCard } from '@/services/reports'
import type { PlanRow } from '@/services/catalogs'
import type { DraftPhoto } from './PhotoPicker'
import type { PlanMarkValue } from './PlanMarkPicker'
import { actions, reportDetails } from '@/shared/i18n/ru'
import { WorkTypeSelect } from './WorkTypeSelect'
import { WorkAssignmentSelect } from './WorkAssignmentSelect'
import { PerformerSelect } from './PerformerSelect'
import { PhotoPicker } from './PhotoPicker'
import { PlanMarkPicker } from './PlanMarkPicker'

/** Существующая фотография отчёта (уже на сервере или в IDB) */
export interface ExistingPhoto {
  id: string
  thumbUrl: string
  r2Key: string
  thumbR2Key: string
  /** Хранилище объектов: 'cloudru' | 'r2'. Может отсутствовать → 'cloudru'. */
  storage?: 'cloudru' | 'r2'
}

/** Результат редактирования — полный набор изменений */
export interface EditReportSaveInput {
  workTypeId: string
  performerId: string
  workAssignmentId: string
  description: string | null
  takenAt: string | null
  planId: string | null | undefined // undefined = не менять
  photosToRemove: Array<{ id: string; r2Key: string; thumbR2Key: string; storage?: 'cloudru' | 'r2' }>
  photosToAdd: DraftPhoto[]
  mark: PlanMarkValue | null | undefined // undefined = не менять
  markChanged: boolean
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
  loading,
  onSave,
  onCancel,
  onWorkTypeCreated,
  onWorkAssignmentCreated,
}: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{
    workTypeId: string
    performerId: string
    workAssignmentId: string
    description: string
    takenAt: dayjs.Dayjs | null
  }>()

  // Фото: какие из существующих удалены, какие новые добавлены
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [newPhotos, setNewPhotos] = useState<DraftPhoto[]>([])

  // План и метка
  const [mark, setMark] = useState<PlanMarkValue | null>(null)
  const [markDirty, setMarkDirty] = useState(false)

  // Инициализация при открытии
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        workTypeId: report.workTypeId,
        performerId: report.performerId,
        workAssignmentId: report.workAssignmentId ?? '',
        description: report.description ?? '',
        takenAt: report.takenAt ? dayjs(report.takenAt) : null,
      })
      setRemovedIds(new Set())
      setNewPhotos([])
      setMark(existingMark)
      setMarkDirty(false)
    }
  }, [open, report, existingMark, form])

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

  const handleMarkChange = useCallback((next: PlanMarkValue | null) => {
    setMark(next)
    setMarkDirty(true)
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
        .map((p) => ({ id: p.id, r2Key: p.r2Key, thumbR2Key: p.thumbR2Key, storage: p.storage }))

      // planId: если метка изменена — берём planId из mark; иначе undefined (не менять)
      let planId: string | null | undefined = undefined
      if (markDirty) {
        planId = mark?.planId ?? null
      }

      await onSave({
        workTypeId: values.workTypeId,
        performerId: values.performerId,
        workAssignmentId: values.workAssignmentId,
        description: values.description?.trim() || null,
        takenAt: values.takenAt?.toISOString() ?? null,
        planId,
        photosToRemove,
        photosToAdd: newPhotos,
        mark: markDirty ? mark : undefined,
        markChanged: markDirty,
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
      destroyOnClose
      width={720}
      style={{ top: 20 }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="workTypeId"
          label={reportDetails.workType}
          rules={[{ required: true, message: 'Выберите вид работ' }]}
        >
          <WorkTypeSelect
            options={workTypes}
            onCreated={(wt) => onWorkTypeCreated?.(wt)}
          />
        </Form.Item>
        <Form.Item
          name="workAssignmentId"
          label={reportDetails.workAssignment}
          rules={[{ required: true, message: 'Выберите назначение работ' }]}
        >
          <WorkAssignmentSelect
            options={workAssignments}
            onCreated={(wa) => onWorkAssignmentCreated?.(wa)}
          />
        </Form.Item>
        <Form.Item
          name="performerId"
          label={reportDetails.performer}
          rules={[{ required: true, message: 'Выберите исполнителя' }]}
        >
          <PerformerSelect options={performers} />
        </Form.Item>
        <Form.Item name="description" label={reportDetails.description}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
        <Form.Item name="takenAt" label={reportDetails.takenAt}>
          <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
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
                  style={{ position: 'absolute', top: 4, right: 4 }}
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
          <PlanMarkPicker plans={plans} value={mark} onChange={handleMarkChange} />
        </>
      )}
    </Modal>
  )
}
