import { useEffect } from 'react'
import { Form, Input, Modal } from 'antd'
import { actions, plansPage } from '@/shared/i18n/ru'

export interface PlanFormValues {
  name: string
  floor: string
  building: string
  section: string
}

interface Props {
  open: boolean
  uploading: boolean
  onSubmit: (values: PlanFormValues) => Promise<void> | void
  onCancel: () => void
}

export function PlanUploadModal({ open, uploading, onSubmit, onCancel }: Props) {
  const [form] = Form.useForm<PlanFormValues>()

  useEffect(() => {
    if (open) form.setFieldsValue({ name: '', floor: '', building: '', section: '' })
  }, [open, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(values)
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      throw e
    }
  }

  return (
    <Modal
      title={plansPage.uploadTitle}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={plansPage.uploadBtn}
      cancelText={actions.cancel}
      confirmLoading={uploading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label={plansPage.fieldName}
          rules={[{ required: true, message: plansPage.requiredName }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="floor" label={plansPage.fieldFloor}>
          <Input placeholder={plansPage.fieldFloorHint} />
        </Form.Item>
        <Form.Item name="building" label={plansPage.fieldBuilding}>
          <Input placeholder={plansPage.fieldBuildingHint} />
        </Form.Item>
        <Form.Item name="section" label={plansPage.fieldSection}>
          <Input placeholder={plansPage.fieldSectionHint} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
