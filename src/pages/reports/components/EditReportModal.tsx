import { useEffect } from 'react'
import { DatePicker, Form, Input, Modal } from 'antd'
import dayjs from 'dayjs'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { ReportCard, ReportUpdateInput } from '@/services/reports'
import { actions, reportDetails } from '@/shared/i18n/ru'
import { WorkTypeSelect } from './WorkTypeSelect'
import { PerformerSelect } from './PerformerSelect'

interface Props {
  open: boolean
  report: ReportCard
  workTypes: WorkType[]
  performers: Performer[]
  loading?: boolean
  onSave: (values: ReportUpdateInput) => Promise<void>
  onCancel: () => void
  onWorkTypeCreated?: (wt: WorkType) => void
}

export function EditReportModal({
  open,
  report,
  workTypes,
  performers,
  loading,
  onSave,
  onCancel,
  onWorkTypeCreated,
}: Props) {
  const [form] = Form.useForm<{
    workTypeId: string
    performerId: string
    description: string
    takenAt: dayjs.Dayjs | null
  }>()

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        workTypeId: report.workTypeId,
        performerId: report.performerId,
        description: report.description ?? '',
        takenAt: report.takenAt ? dayjs(report.takenAt) : null,
      })
    }
  }, [open, report, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      await onSave({
        workTypeId: values.workTypeId,
        performerId: values.performerId,
        description: values.description?.trim() || null,
        takenAt: values.takenAt?.toISOString() ?? null,
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
    </Modal>
  )
}
