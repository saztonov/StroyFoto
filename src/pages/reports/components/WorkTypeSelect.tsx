import type { WorkType } from '@/entities/workType/types'
import { createOrQueueWorkType } from '@/services/catalogs'
import { useAuth } from '@/app/providers/AuthProvider'
import { CreatableCatalogSelect } from './CreatableCatalogSelect'

interface Props {
  options: WorkType[]
  value?: string
  onChange?: (id: string) => void
  onCreated: (wt: WorkType) => void
  disabled?: boolean
}

export function WorkTypeSelect(props: Props) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <CreatableCatalogSelect<WorkType>
      {...props}
      canCreate={isAdmin}
      placeholder={isAdmin ? 'Выберите или введите новый' : 'Выберите вид работ'}
      successMessage="Вид работ добавлен"
      errorMessage="Не удалось сохранить вид работ"
      emptyHint={
        isAdmin
          ? 'Введите название, чтобы создать новое'
          : 'Ничего не найдено. Новые виды работ добавляет администратор'
      }
      createOrQueue={createOrQueueWorkType}
    />
  )
}
