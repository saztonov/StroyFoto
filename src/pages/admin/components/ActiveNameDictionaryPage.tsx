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
  Radio,
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

/**
 * Штатный способ вывода позиции из оборота — «Архив» (is_active = false), а не
 * удаление: офлайн-устройства могут держать черновики отчётов со ссылкой на неё,
 * и физическое удаление обернётся FK-ошибкой при возвращении устройства в сеть.
 *
 * Физическое удаление доступно, когда передан `remove` — для опечаток и мусорных
 * записей. Сервер откажет (DICT_IN_USE), если позиция уже использована в отчётах.
 */
type ActiveFilter = 'active' | 'archived' | 'all'

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
  /** Не передан — кнопки удаления нет, доступен только архив. */
  remove?: (id: string) => Promise<unknown>
  successDeleted?: string
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
  remove,
  successDeleted = 'Запись удалена',
}: Props<T>) {
  const { message, modal } = App.useApp()
  const isDesktop = useIsDesktop()
  const { data, loading, error, refresh } = useAdminResource<T>(useCallback(list, [list]))
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active')
  const [editing, setEditing] = useState<T | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<{ name: string }>()
  const [saving, setSaving] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((w) => {
      if (activeFilter === 'active' && !w.is_active) return false
      if (activeFilter === 'archived' && w.is_active) return false
      if (q && !w.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, search, activeFilter])

  const archivedCount = useMemo(() => data.filter((w) => !w.is_active).length, [data])

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

  const handleDelete = (item: T) => {
    if (!remove) return
    modal.confirm({
      title: `Удалить «${item.name}»?`,
      // Сервер откажет, если позиция уже в отчётах, но про офлайн-черновики он не
      // знает — предупреждаем здесь.
      content:
        'Отменить удаление нельзя. Если позиция используется в отчётах, сервер её не отдаст. ' +
        'Черновики на устройствах, которые сейчас офлайн, при синхронизации получат ошибку — ' +
        'для вывода из оборота безопаснее архив.',
      okText: 'Удалить',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      onOk: async () => {
        setSavingId(item.id)
        try {
          await remove(item.id)
          message.success(successDeleted)
          void refresh()
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Ошибка')
          throw err // оставляем модалку открытой, чтобы причина осталась на виду
        } finally {
          setSavingId(null)
        }
      },
    })
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
      width: remove ? 200 : 120,
      render: (_, item) => (
        <Space size="small">
          <Button size="small" onClick={() => openEdit(item)}>
            Изменить
          </Button>
          {remove ? (
            <Button size="small" danger onClick={() => handleDelete(item)}>
              Удалить
            </Button>
          ) : null}
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

      <Flex gap={12} style={{ marginBottom: 16, flexWrap: 'wrap' }} align="center">
        <Input.Search
          placeholder="Поиск"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <Radio.Group
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'archived', label: archivedCount > 0 ? `Архив (${archivedCount})` : 'Архив' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <Button onClick={() => void refresh()}>Обновить</Button>
      </Flex>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}

      {!loading && filtered.length === 0 ? (
        data.length === 0 ? (
          <EmptySection
            title={emptyTitle}
            extra={<Button type="primary" onClick={openCreate}>Добавить</Button>}
          />
        ) : (
          // Справочник не пуст — просто ничего не попало под фильтр. Предлагать
          // здесь «Добавить» было бы сбивающе.
          <EmptySection title="По выбранным условиям ничего не найдено" />
        )
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
                  {remove ? (
                    <Button size="small" danger onClick={() => handleDelete(item)}>
                      Удалить
                    </Button>
                  ) : null}
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
