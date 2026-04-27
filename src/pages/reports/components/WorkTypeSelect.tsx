import { useMemo, useState } from 'react'
import { App, Select, Spin, Typography } from 'antd'
import type { SelectProps } from 'antd'
import type { WorkType } from '@/entities/workType/types'
import { createOrQueueWorkType } from '@/services/catalogs'
import { triggerSync } from '@/services/sync'

interface Props {
  options: WorkType[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wt: WorkType) => void
  disabled?: boolean
}

/**
 * Select с инлайн-созданием. Пользователь набирает название; если совпадения
 * нет — в самом низу списка появляется виртуальная опция «Создать "X"».
 * Клик по ней создаёт запись через `createOrQueueWorkType` — функция одинаково
 * работает онлайн и офлайн: онлайн — отправит через sync-очередь сразу,
 * офлайн — оставит в IDB и зашедулит upsert на возвращение сети.
 */
export function WorkTypeSelect({ options, value, onChange, onCreated, disabled }: Props) {
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
      const wt = await createOrQueueWorkType(name)
      onCreated(wt)
      onChange?.(wt.id)
      setSearch('')
      message.success('Вид работ добавлен')
      triggerSync()
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Не удалось сохранить вид работ',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Select
      showSearch
      placeholder="Выберите или введите новый"
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
        // Виртуальную опцию "Создать" не фильтруем (она и так показывается только при неполном совпадении).
        if (typeof option.value === 'string' && option.value.startsWith('__create__:')) return true
        return String(option.label).toLowerCase().includes(input.toLowerCase())
      }}
    />
  )
}
