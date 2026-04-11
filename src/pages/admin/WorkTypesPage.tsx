import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { useAdminResource } from '@/shared/hooks/useAdminResource'
import {
  createWorkType,
  listWorkTypes,
  setWorkTypeActive,
  updateWorkType,
} from '@/services/admin'
import type { WorkType } from '@/entities/workType/types'
import { nav } from '@/shared/i18n/ru'

export function WorkTypesPage() {
  const { message } = App.useApp()
  const { data, loading, error, refresh } = useAdminResource<WorkType>(useCallback(listWorkTypes, []))
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<WorkType | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<{ name: string }>()
  const [saving, setSaving] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter((w) => w.name.toLowerCase().includes(q))
  }, [data, search])

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    form.resetFields()
  }

  const openEdit = (item: WorkType) => {
    setEditing(item)
    setCreating(false)
    form.setFieldsValue({ name: item.name })
  }

  const close = () => {
    setCreating(false)
    setEditing(null)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const name = values.name.trim()
      if (editing) {
        await updateWorkType(editing.id, name)
        message.success('Вид работ обновлён')
      } else {
        await createWorkType(name)
        message.success('Вид работ создан')
      }
      close()
      void refresh()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleActive = async (item: WorkType, value: boolean) => {
    setSavingId(item.id)
    try {
      await setWorkTypeActive(item.id, value)
      void refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<WorkType> = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Источник',
      key: 'source',
      width: 180,
      responsive: ['sm'],
      render: (_, item) =>
        item.created_by ? <Tag color="blue">Создано пользователем</Tag> : <Tag>Справочник</Tag>,
    },
    {
      title: 'Активен',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean, item) => (
        <Switch
          checked={active}
          loading={savingId === item.id}
          onChange={(v) => handleActive(item, v)}
        />
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 120,
      render: (_, item) => (
        <Space size="small">
          <Button size="small" onClick={() => openEdit(item)}>
            Изменить
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={nav.adminWorkTypes}
        subtitle="Справочник видов работ"
        extra={
          <Button type="primary" onClick={openCreate}>
            Добавить
          </Button>
        }
      />

      <Flex gap={12} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Поиск"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Button onClick={() => void refresh()}>Обновить</Button>
      </Flex>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptySection
          title="Видов работ пока нет"
          extra={<Button type="primary" onClick={openCreate}>Добавить</Button>}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 600 }}
          size="middle"
        />
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Изменить вид работ' : 'Новый вид работ'}
        onCancel={close}
        onOk={submit}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Монолитные работы" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
