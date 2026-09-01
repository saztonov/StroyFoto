import { useState } from 'react'
import { App, Form, Input, Modal, Typography } from 'antd'
import { ApiError } from '@/lib/apiClient'
import { changeMyPassword, mapAuthError } from '@/services/auth'
import { useAuth } from '@/app/providers/AuthProvider'
import { actions, passwordReset } from '@/shared/i18n/ru'

interface FormValues {
  current: string
  next: string
  repeat: string
}

interface Props {
  open: boolean
  onClose: () => void
}

export function ChangePasswordModal({ open, onClose }: Props) {
  const { message } = App.useApp()
  const { adoptSession } = useAuth()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  async function handleOk() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const { data, persistent } = await changeMyPassword(values.current, values.next)
      // Сервер погасил все сессии и выдал новую этому устройству. Принимаем её
      // тем же путём, что и логин, сохраняя прежний режим хранения.
      await adoptSession(data, { persistent })
      message.success(passwordReset.changed)
      form.resetFields()
      onClose()
    } catch (e) {
      // Пароль мог смениться, даже если сюда прилетела ошибка: сеть отвалилась
      // после коммита, ответ не дошёл, применение сессии упало. Отличить это
      // от «ничего не произошло» клиент не может, поэтому не утверждаем, что
      // смены не было.
      const ambiguous =
        !(e instanceof ApiError) || e.status === 0 || e.status >= 500
      message.error(ambiguous ? passwordReset.ambiguous : mapAuthError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={passwordReset.changeTitle}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
      onOk={handleOk}
      confirmLoading={saving}
      okText={actions.save}
      cancelText={actions.cancel}
      forceRender
    >
      <Form form={form} layout="vertical" disabled={saving}>
        <Form.Item
          name="current"
          label={passwordReset.currentLabel}
          rules={[{ required: true, message: 'Введите текущий пароль' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="next"
          label={passwordReset.newLabel}
          rules={[
            { required: true, message: 'Введите новый пароль' },
            { min: 6, message: 'Пароль должен быть не короче 6 символов' },
            {
              // bcrypt читает только первые 72 байта, поэтому граница в байтах,
              // а не в символах: кириллица занимает по два.
              validator: (_, value: string) =>
                !value || new TextEncoder().encode(value).length <= 72
                  ? Promise.resolve()
                  : Promise.reject(new Error('Не более 72 байт')),
            },
          ]}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {passwordReset.lengthHint}
            </Typography.Text>
          }
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="repeat"
          label={passwordReset.repeatLabel}
          dependencies={['next']}
          rules={[
            { required: true, message: 'Повторите новый пароль' },
            ({ getFieldValue }) => ({
              validator: (_, value: string) =>
                !value || getFieldValue('next') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(passwordReset.repeatMismatch)),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
