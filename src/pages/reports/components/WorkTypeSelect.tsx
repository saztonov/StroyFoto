import { useState } from 'react'
import { Button, Divider, Flex, Input, Select, Spin, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { WorkType } from '@/entities/workType/types'
import { createWorkType } from '@/services/catalogs'

interface Props {
  options: WorkType[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wt: WorkType) => void
  disabled?: boolean
}

export function WorkTypeSelect({ options, value, onChange, onCreated, disabled }: Props) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const addNew = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const wt = await createWorkType(name)
      onCreated(wt)
      onChange?.(wt.id)
      setNewName('')
      message.success('Вид работ добавлен')
    } catch (e) {
      message.error(
        e instanceof Error
          ? e.message
          : 'Не удалось создать вид работ. Для добавления нужен интернет.',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Select
      showSearch
      placeholder="Выберите вид работ"
      optionFilterProp="label"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options.map((o) => ({ value: o.id, label: o.name }))}
      dropdownRender={(menu) => (
        <>
          {menu}
          <Divider style={{ margin: '8px 0' }} />
          <Flex gap={4} style={{ padding: '0 8px 8px' }}>
            <Input
              placeholder="Новый вид работ"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault()
                void addNew()
              }}
            />
            <Button
              type="primary"
              icon={creating ? <Spin size="small" /> : <PlusOutlined />}
              onClick={() => void addNew()}
              disabled={!newName.trim() || creating}
            >
              Добавить
            </Button>
          </Flex>
        </>
      )}
    />
  )
}
