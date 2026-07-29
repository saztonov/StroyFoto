import type { WorkAssignment } from '@/entities/workAssignment/types'
import { createOrQueueWorkAssignment } from '@/services/catalogs'
import { useAuth } from '@/app/providers/AuthProvider'
import { CreatableCatalogSelect } from './CreatableCatalogSelect'

interface Props {
  options: WorkAssignment[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wa: WorkAssignment) => void
  disabled?: boolean
}

export function WorkAssignmentSelect(props: Props) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <CreatableCatalogSelect<WorkAssignment>
      {...props}
      canCreate={isAdmin}
      placeholder={isAdmin ? 'Выберите или введите новое' : 'Выберите назначение работ'}
      successMessage="Назначение работ добавлено"
      errorMessage="Не удалось сохранить назначение работ"
      emptyHint={
        isAdmin
          ? 'Введите название, чтобы создать новое'
          : 'Ничего не найдено. Новые назначения добавляет администратор'
      }
      createOrQueue={createOrQueueWorkAssignment}
    />
  )
}
