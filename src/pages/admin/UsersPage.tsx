import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  Modal,
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
  listProfiles,
  listProjects,
  listProjectMemberships,
  setProfileActive,
  setProfileRole,
  setUserProjects,
  updateProfileFullName,
} from '@/services/admin'
import type { AdminProfile, Role } from '@/entities/profile/types'
import { nav } from '@/shared/i18n/ru'

export function UsersPage() {
  const usersResource = useAdminResource<AdminProfile>(useCallback(listProfiles, []))
  const projectsResource = useAdminResource(useCallback(listProjects, []))
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AdminProfile | null>(null)
  const [editForm] = Form.useForm<{ full_name: string }>()
  const [assigning, setAssigning] = useState<AdminProfile | null>(null)
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [assignLoading, setAssignLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return usersResource.data
    return usersResource.data.filter(
      (u) =>
        (u.full_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [usersResource.data, search])

  const openAssign = async (user: AdminProfile) => {
    setAssigning(user)
    setAssignLoading(true)
    try {
      const ids = await listProjectMemberships(user.id)
      setAssignedIds(ids)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setAssignLoading(false)
    }
  }

  const submitAssign = async () => {
    if (!assigning) return
    setAssignLoading(true)
    try {
      await setUserProjects(assigning.id, assignedIds)
      message.success('Доступы обновлены')
      setAssigning(null)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setAssignLoading(false)
    }
  }

  const submitEdit = async () => {
    if (!editing) return
    try {
      const values = await editForm.validateFields()
      await updateProfileFullName(editing.id, values.full_name.trim())
      message.success('ФИО обновлено')
      setEditing(null)
      void usersResource.refresh()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
    }
  }

  const handleActive = async (user: AdminProfile, value: boolean) => {
    setSavingId(user.id)
    try {
      await setProfileActive(user.id, value)
      void usersResource.refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const handleRole = async (user: AdminProfile, value: Role) => {
    setSavingId(user.id)
    try {
      await setProfileRole(user.id, value)
      void usersResource.refresh()
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  const columns: ColumnsType<AdminProfile> = [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      render: (value: string | null) => value || <Tag>не указано</Tag>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      responsive: ['md'],
    },
    {
      title: 'Роль',
      dataIndex: 'role',
      key: 'role',
      width: 140,
      render: (role: Role, user) => (
        <Select<Role>
          value={role}
          size="small"
          style={{ width: 120 }}
          disabled={savingId === user.id}
          onChange={(v) => handleRole(user, v)}
          options={[
            { value: 'user', label: 'Пользователь' },
            { value: 'admin', label: 'Администратор' },
          ]}
        />
      ),
    },
    {
      title: 'Активен',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean, user) => (
        <Switch
          checked={active}
          loading={savingId === user.id}
          onChange={(v) => handleActive(user, v)}
        />
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 220,
      render: (_, user) => (
        <Space size="small" wrap>
          <Button
            size="small"
            onClick={() => {
              setEditing(user)
              editForm.setFieldsValue({ full_name: user.full_name ?? '' })
            }}
          >
            ФИО
          </Button>
          <Button size="small" onClick={() => openAssign(user)}>
            Проекты
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader title={nav.adminUsers} subtitle="Активация, ФИО, роли, назначение проектов" />

      <Flex gap={12} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Поиск по ФИО или email"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Button onClick={() => void usersResource.refresh()}>Обновить</Button>
      </Flex>

      {usersResource.error ? (
        <Alert type="error" showIcon message={usersResource.error} style={{ marginBottom: 16 }} />
      ) : null}

      {!usersResource.loading && filtered.length === 0 ? (
        <EmptySection title="Пользователи не найдены" />
      ) : (
        <Table
          rowKey="id"
          loading={usersResource.loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 720 }}
          size="middle"
        />
      )}

      <Modal
        open={editing !== null}
        title="Изменить ФИО"
        onCancel={() => setEditing(null)}
        onOk={submitEdit}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="full_name"
            label="ФИО"
            rules={[{ required: true, message: 'Введите ФИО' }]}
          >
            <Input placeholder="Иванов Иван Иванович" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={assigning !== null}
        title={`Проекты пользователя${assigning?.full_name ? `: ${assigning.full_name}` : ''}`}
        onCancel={() => setAssigning(null)}
        onOk={submitAssign}
        confirmLoading={assignLoading}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        {projectsResource.error ? (
          <Alert type="error" showIcon message={projectsResource.error} style={{ marginBottom: 12 }} />
        ) : null}
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Выберите проекты"
          loading={projectsResource.loading || assignLoading}
          value={assignedIds}
          onChange={setAssignedIds}
          optionFilterProp="label"
          options={projectsResource.data.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Modal>
    </>
  )
}
