import type { WorkType } from '@/entities/workType/types'
import { createOrQueueWorkType } from '@/services/catalogs'
import { CreatableCatalogSelect } from './CreatableCatalogSelect'

interface Props {
  options: WorkType[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wt: WorkType) => void
  disabled?: boolean
}

export function WorkTypeSelect(props: Props) {
  return (
    <CreatableCatalogSelect<WorkType>
      {...props}
      placeholder="Выберите или введите новый"
      successMessage="Вид работ добавлен"
      errorMessage="Не удалось сохранить вид работ"
      emptyHint="Введите название, чтобы создать новое"
      createOrQueue={createOrQueueWorkType}
    />
  )
}
