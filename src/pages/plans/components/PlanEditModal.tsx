import { useEffect } from 'react'
import { Form, Input, Modal } from 'antd'
import { actions, plansPage } from '@/shared/i18n/ru'
import type { PlanRecord } from '@/services/plans'
import type { PlanFormValues } from './PlanUploadModal'

interface Props {
  plan: PlanRecord | null
  saving: boolean
  onSubmit: (values: PlanFormValues) => Promise<void> | void
  onCancel: () => void
}

export function PlanEditModal({ plan, saving, onSubmit, onCancel }: Props) {
  const [form] = Form.useForm<PlanFormValues>()

  useEffect(() => {
    if (plan) {
      form.setFieldsValue({
        name: plan.name,
        floor: plan.floor || '',
        building: plan.building || '',
        section: plan.section || '',
      })
    }
  }, [plan, form])

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
      title={plansPage.editTitle}
      open={!!plan}
      onOk={handleOk}
      onCancel={onCancel}
      okText={actions.save}
      cancelText={actions.cancel}
      confirmLoading={saving}
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
