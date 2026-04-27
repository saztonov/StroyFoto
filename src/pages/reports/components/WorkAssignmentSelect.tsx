import { useMemo, useState } from 'react'
import { App, Select, Spin, Typography } from 'antd'
import type { SelectProps } from 'antd'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { createOrQueueWorkAssignment } from '@/services/catalogs'
import { triggerSync } from '@/services/sync'

interface Props {
  options: WorkAssignment[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wa: WorkAssignment) => void
  disabled?: boolean
}

/**
 * Select с инлайн-созданием назначения работ. Полная аналогия `WorkTypeSelect`:
 * пользователь набирает название → если совпадения нет, в списке появляется
 * виртуальная опция «Создать "X"». Клик создаёт запись через
 * `createOrQueueWorkAssignment` (одинаково работает онлайн и офлайн).
 */
export function WorkAssignmentSelect({ options, value, onChange, onCreated, disabled }: Props) {
  const { message } = App.useApp()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const selectOptions = useMemo<SelectProps['options']>(() => {
    const base = options.map((o) => ({ value: o.id, label: o.name }))
    const trimmed = search.trim()
    if (!trimmed) return base
    const alreadyExists = options.some(
      (o) => o.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (alreadyExists) return base
    return [
      ...base,
      {
        value: `__create__:${trimmed}`,
        label: `Создать «${trimmed}»`,
      },
    ]
  }, [options, search])

  const handleSelect = async (raw: string) => {
    if (!raw.startsWith('__create__:')) {
      onChange?.(raw)
      return
    }
    const name = raw.slice('__create__:'.length)
    setCreating(true)
    try {
      const wa = await createOrQueueWorkAssignment(name)
      onCreated(wa)
      onChange?.(wa.id)
      setSearch('')
      message.success('Назначение работ добавлено')
      triggerSync()
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Не удалось сохранить назначение работ',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Select
      showSearch
      placeholder="Выберите или введите новое"
      optionFilterProp="label"
      value={value}
      disabled={disabled || creating}
      onSearch={setSearch}
      searchValue={search}
      onSelect={handleSelect}
      options={selectOptions}
      notFoundContent={
        creating ? (
          <Spin size="small" />
        ) : (
          <Typography.Text type="secondary">Введите название, чтобы создать новое</Typography.Text>
        )
      }
      filterOption={(input, option) => {
        if (!option?.label) return false
        if (typeof option.value === 'string' && option.value.startsWith('__create__:')) return true
        return String(option.label).toLowerCase().includes(input.toLowerCase())
      }}
    />
  )
}
