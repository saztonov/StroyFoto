import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { useAdminResource } from '@/shared/hooks/useAdminResource'
import {
  createPerformer,
  listPerformers,
  setPerformerActive,
  updatePerformer,
} from '@/services/admin'
import type { Performer, PerformerKind } from '@/entities/performer/types'
import { nav } from '@/shared/i18n/ru'

type KindFilter = 'all' | PerformerKind

const KIND_LABEL: Record<PerformerKind, string> = {
  contractor: 'Подрядчик',
  own_forces: 'Собственные силы',
}

interface FormValues {
  name: string
  kind: PerformerKind
}

export function PerformersPage() {
  const { data, loading, error, refresh } = useAdminResource<Performer>(useCallback(listPerformers, []))
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [editing, setEditing] = useState<Performer | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, search, kindFilter])

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ kind: 'contractor' })
  }

  const openEdit = (item: Performer) => {
    setEditing(item)
    setCreating(false)
    form.setFieldsValue({ name: item.name, kind: item.kind })
  }

  const close = () => {
    setCreating(false)
    setEditing(null)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = { name: values.name.trim(), kind: values.kind }
      if (editing) {
        await updatePerformer(editing.id, payload)
        message.success('Исполнитель обновлён')
      } else {
        await createPerformer(payload)
        message.success('Исполнитель создан')
      }
      close()
      void refresh()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleActive = async (item: Performer, value: boolean) => {
    setSavingId(item.id)
    try {
      await setPerformerActive(item.id, value)
      void refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<Performer> = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Тип',
      dataIndex: 'kind',
      key: 'kind',
      width: 180,
      render: (kind: PerformerKind) => (
        <Tag color={kind === 'contractor' ? 'geekblue' : 'green'}>{KIND_LABEL[kind]}</Tag>
      ),
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
        title={nav.adminPerformers}
        subtitle="Подрядчики и собственные силы"
        extra={
          <Button type="primary" onClick={openCreate}>
            Добавить
          </Button>
        }
      />

      <Flex gap={12} style={{ marginBottom: 16, flexWrap: 'wrap' }} align="center">
        <Input.Search
          placeholder="Поиск"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <Radio.Group
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { value: 'all', label: 'Все' },
            { value: 'contractor', label: 'Подрядчики' },
            { value: 'own_forces', label: 'Свои силы' },
          ]}
        />
        <Button onClick={() => void refresh()}>Обновить</Button>
      </Flex>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptySection
          title="Исполнителей нет"
          extra={<Button type="primary" onClick={openCreate}>Добавить</Button>}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 640 }}
          size="middle"
        />
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Изменить исполнителя' : 'Новый исполнитель'}
        onCancel={close}
        onOk={submit}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ kind: 'contractor' }}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="ООО Стройка" />
          </Form.Item>
          <Form.Item
            name="kind"
            label="Тип"
            rules={[{ required: true, message: 'Выберите тип' }]}
          >
            <Select<PerformerKind>
              options={[
                { value: 'contractor', label: KIND_LABEL.contractor },
                { value: 'own_forces', label: KIND_LABEL.own_forces },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
