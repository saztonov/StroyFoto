import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { useAdminResource } from '@/shared/hooks/useAdminResource'
import { useIsDesktop } from '@/shared/hooks/useBreakpoint'

interface DictionaryItem {
  id: string
  name: string
  is_active: boolean
  created_by: string | null
}

interface Props<T extends DictionaryItem> {
  title: string
  subtitle: string
  emptyTitle: string
  modalCreateTitle: string
  modalEditTitle: string
  successCreated: string
  successUpdated: string
  fieldPlaceholder: string
  list: () => Promise<T[]>
  create: (name: string) => Promise<unknown>
  update: (id: string, name: string) => Promise<unknown>
  setActive: (id: string, active: boolean) => Promise<unknown>
}

/**
 * Универсальный admin-CRUD для справочника вида { id, name, is_active, created_by }.
 * Используется WorkTypesPage и WorkAssignmentsPage — структура и поведение идентичны.
 */
export function ActiveNameDictionaryPage<T extends DictionaryItem>({
  title,
  subtitle,
  emptyTitle,
  modalCreateTitle,
  modalEditTitle,
  successCreated,
  successUpdated,
  fieldPlaceholder,
  list,
  create,
  update,
  setActive,
}: Props<T>) {
  const { message } = App.useApp()
  const isDesktop = useIsDesktop()
  const { data, loading, error, refresh } = useAdminResource<T>(useCallback(list, [list]))
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<T | null>(null)
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

  const openEdit = (item: T) => {
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
        await update(editing.id, name)
        message.success(successUpdated)
      } else {
        await create(name)
        message.success(successCreated)
      }
      close()
      void refresh()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleActive = async (item: T, value: boolean) => {
    setSavingId(item.id)
    try {
      await setActive(item.id, value)
      void refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<T> = [
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
        title={title}
        subtitle={subtitle}
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
          title={emptyTitle}
          extra={<Button type="primary" onClick={openCreate}>Добавить</Button>}
        />
      ) : isDesktop ? (
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 600 }}
          size="middle"
        />
      ) : (
        <List
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          renderItem={(item) => (
            <List.Item style={{ padding: '6px 0', border: 'none' }}>
              <Card size="small" style={{ width: '100%' }}>
                <Flex justify="space-between" align="center">
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <Switch
                    checked={item.is_active}
                    loading={savingId === item.id}
                    onChange={(v) => handleActive(item, v)}
                    checkedChildren="Акт."
                    unCheckedChildren="Выкл."
                  />
                </Flex>
                <div style={{ marginTop: 6 }}>
                  {item.created_by
                    ? <Tag color="blue">Создано пользователем</Tag>
                    : <Tag>Справочник</Tag>}
                </div>
                <Flex gap={8} style={{ marginTop: 10 }}>
                  <Button size="small" onClick={() => openEdit(item)}>
                    Изменить
                  </Button>
                </Flex>
              </Card>
            </List.Item>
          )}
        />
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? modalEditTitle : modalCreateTitle}
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
            <Input placeholder={fieldPlaceholder} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
