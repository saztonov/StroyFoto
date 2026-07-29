import { useState } from 'react'
import { App, Alert, Modal, Select, Space, Typography } from 'antd'
import type { CatalogKind } from '@/lib/db'
import { replaceBlockedCatalog } from '@/services/sync'
import type { WorkType } from '@/entities/workType/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'

interface Props {
  open: boolean
  catalogKind: CatalogKind | null
  oldId: string | null
  message: string | null
  workTypes: WorkType[]
  workAssignments: WorkAssignment[]
  onCancel: () => void
  onDone: () => void
}

/**
 * Ручной выход из состояния `blocked`: отчёт ссылается на позицию справочника,
 * которую сервер не пропустил (новые добавляет только админ; архивные выбрать
 * нельзя). Пользователь выбирает существующую активную позицию, и отчёт уходит
 * на сервер уже с ней.
 *
 * Отдельная модалка, а не обычное редактирование: заблокированный отчёт на
 * сервере ещё не создан, и PATCH из saveReport вернул бы 404.
 */
export function ReplaceBlockedCatalogModal({
  open,
  catalogKind,
  oldId,
  message,
  workTypes,
  workAssignments,
  onCancel,
  onDone,
}: Props) {
  const { message: toast } = App.useApp()
  const [value, setValue] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const isWorkType = catalogKind === 'work_type'
  const label = isWorkType ? 'вид работ' : 'назначение работ'
  // Списки приходят с сервера уже отфильтрованными по is_active, но исключаем
  // саму заблокированную позицию: она может лежать в кэше как фантом.
  const options = (isWorkType ? workTypes : workAssignments)
    .filter((o) => o.id !== oldId)
    .map((o) => ({ value: o.id, label: o.name }))

  const handleOk = async () => {
    if (!catalogKind || !oldId || !value) return
    setSaving(true)
    try {
      await replaceBlockedCatalog({ kind: catalogKind, oldId, newId: value })
      toast.success('Отчёт отправлен на синхронизацию')
      setValue(undefined)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось заменить позицию')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`Заменить ${label}`}
      okText="Заменить"
      cancelText="Отмена"
      confirmLoading={saving}
      okButtonProps={{ disabled: !value }}
      onOk={handleOk}
      onCancel={() => {
        setValue(undefined)
        onCancel()
      }}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {message && <Alert type="warning" showIcon message={message} />}
        <Typography.Text type="secondary">
          Выберите {label} из справочника. Отчёт и его фотографии сохранятся —
          изменится только эта позиция.
        </Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={isWorkType ? 'Выберите вид работ' : 'Выберите назначение работ'}
          value={value}
          onChange={setValue}
          options={options}
          style={{ width: '100%' }}
          notFoundContent={
            <Typography.Text type="secondary">
              Справочник пуст. Обратитесь к администратору
            </Typography.Text>
          }
        />
      </Space>
    </Modal>
  )
}
