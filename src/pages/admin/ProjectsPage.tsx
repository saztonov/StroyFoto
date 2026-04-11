import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { useAdminResource } from '@/shared/hooks/useAdminResource'
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from '@/services/admin'
import type { Project } from '@/entities/project/types'
import { nav } from '@/shared/i18n/ru'

interface FormValues {
  name: string
  description?: string
}

export function ProjectsPage() {
  const { message } = App.useApp()
  const { data, loading, error, refresh } = useAdminResource<Project>(useCallback(listProjects, []))
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Project | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter((p) => p.name.toLowerCase().includes(q))
  }, [data, search])

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    form.resetFields()
  }

  const openEdit = (project: Project) => {
    setEditing(project)
    setCreating(false)
    form.setFieldsValue({ name: project.name, description: project.description ?? '' })
  }

  const close = () => {
    setCreating(false)
    setEditing(null)
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = { name: values.name.trim(), description: values.description?.trim() || null }
      if (editing) {
        await updateProject(editing.id, payload)
        message.success('Проект обновлён')
      } else {
        await createProject(payload)
        message.success('Проект создан')
      }
      close()
      void refresh()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id)
      message.success('Проект удалён')
      void refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось удалить')
    }
  }

  const columns: ColumnsType<Project> = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Описание',
      dataIndex: 'description',
      key: 'description',
      responsive: ['md'],
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 200,
      render: (_, project) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => openEdit(project)}>
            Изменить
          </Button>
          <Popconfirm
            title="Удалить проект?"
            description="Связанные данные могут быть удалены."
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(project.id)}
          >
            <Button size="small" danger>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={nav.adminProjects}
        subtitle="Справочник проектов"
        extra={
          <Button type="primary" onClick={openCreate}>
            Создать проект
          </Button>
        }
      />

      <Flex gap={12} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Поиск по названию"
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
          title="Проектов пока нет"
          extra={<Button type="primary" onClick={openCreate}>Создать первый</Button>}
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
        title={editing ? 'Изменить проект' : 'Новый проект'}
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
            <Input placeholder="ЖК Восток, корпус 3" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} placeholder="Необязательно" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
