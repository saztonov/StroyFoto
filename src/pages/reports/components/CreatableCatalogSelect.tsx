import { useMemo, useState } from 'react'
import { App, Select, Spin, Typography } from 'antd'
import type { SelectProps } from 'antd'
import { triggerSync } from '@/services/sync'

interface CatalogItem {
  id: string
  name: string
}

interface Props<T extends CatalogItem> {
  options: T[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (item: T) => void
  // Создавать новые позиции справочника может только админ. У остальных
  // селект работает как обычный выбор из списка.
  canCreate: boolean
  disabled?: boolean
  placeholder: string
  successMessage: string
  errorMessage: string
  emptyHint: string
  createOrQueue: (name: string) => Promise<T>
}

/**
 * Select со встроенным онлайн/офлайн созданием новой записи. Если введённое
 * имя не совпадает ни с одной опцией — в самом низу появляется виртуальная
 * опция «Создать "X"». Клик создаёт запись через `createOrQueue`, которая
 * сама решает: онлайн — отправить через sync-очередь сразу, офлайн —
 * оставить в IDB и выполнить upsert при возвращении сети.
 *
 * Виртуальная опция показывается только при `canCreate`. Сервер enforce'ит
 * то же правило независимо (`DICT_CREATE_FORBIDDEN`) — здесь мы лишь убираем
 * affordance, чтобы пользователь не упирался в отказ уже после ввода.
 */
export function CreatableCatalogSelect<T extends CatalogItem>({
  options,
  value,
  onChange,
  onCreated,
  canCreate,
  disabled,
  placeholder,
  successMessage,
  errorMessage,
  emptyHint,
  createOrQueue,
}: Props<T>) {
  const { message } = App.useApp()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const selectOptions = useMemo<SelectProps['options']>(() => {
    const base = options.map((o) => ({ value: o.id, label: o.name }))
    if (!canCreate) return base
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
  }, [options, search, canCreate])

  const handleSelect = async (raw: string) => {
    // Защита от рассинхрона: без прав создания sentinel не должен доходить сюда.
    if (!raw.startsWith('__create__:') || !canCreate) {
      onChange?.(raw)
      return
    }
    const name = raw.slice('__create__:'.length)
    setCreating(true)
    try {
      const item = await createOrQueue(name)
      onCreated(item)
      onChange?.(item.id)
      setSearch('')
      message.success(successMessage)
      triggerSync()
    } catch (e) {
      message.error(e instanceof Error ? e.message : errorMessage)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Select
      showSearch
      placeholder={placeholder}
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
          <Typography.Text type="secondary">{emptyHint}</Typography.Text>
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
