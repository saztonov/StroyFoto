import {
  createWorkAssignment,
  listWorkAssignments,
  setWorkAssignmentActive,
  updateWorkAssignment,
} from '@/services/admin'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { nav } from '@/shared/i18n/ru'
import { ActiveNameDictionaryPage } from './components/ActiveNameDictionaryPage'

export function WorkAssignmentsPage() {
  return (
    <ActiveNameDictionaryPage<WorkAssignment>
      title={nav.adminWorkAssignments}
      subtitle="Справочник назначений работ"
      emptyTitle="Назначений работ пока нет"
      modalCreateTitle="Новое назначение работ"
      modalEditTitle="Изменить назначение работ"
      successCreated="Назначение работ создано"
      successUpdated="Назначение работ обновлено"
      fieldPlaceholder="Подготовка площадки"
      list={listWorkAssignments}
      create={createWorkAssignment}
      update={updateWorkAssignment}
      setActive={setWorkAssignmentActive}
    />
  )
}
