import { Select } from 'antd'
import type { Performer } from '@/entities/performer/types'

interface Props {
  options: Performer[]
  /** Набор подрядчиков; первый элемент считается основным. */
  value?: string[]
  onChange?: (ids: string[]) => void
  disabled?: boolean
}

export function PerformerSelect({ options, value, onChange, disabled }: Props) {
  const contractors = options.filter((p) => p.kind === 'contractor')
  const own = options.filter((p) => p.kind === 'own_forces')

  return (
    <Select
      mode="multiple"
      showSearch
      allowClear
      placeholder="Выберите исполнителей"
      optionFilterProp="label"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={[
        {
          label: 'Подрядчики',
          options: contractors.map((p) => ({ value: p.id, label: p.name })),
        },
        {
          label: 'Собственные силы',
          options: own.map((p) => ({ value: p.id, label: p.name })),
        },
      ]}
    />
  )
}
