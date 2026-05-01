import type { WorkAssignment } from '@/entities/workAssignment/types'
import { createOrQueueWorkAssignment } from '@/services/catalogs'
import { CreatableCatalogSelect } from './CreatableCatalogSelect'

interface Props {
  options: WorkAssignment[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wa: WorkAssignment) => void
  disabled?: boolean
}

export function WorkAssignmentSelect(props: Props) {
  return (
    <CreatableCatalogSelect<WorkAssignment>
      {...props}
      placeholder="Выберите или введите новое"
      successMessage="Назначение работ добавлено"
      errorMessage="Не удалось сохранить назначение работ"
      emptyHint="Введите название, чтобы создать новое"
      createOrQueue={createOrQueueWorkAssignment}
    />
  )
}
