import { createWorkType, listWorkTypes, setWorkTypeActive, updateWorkType } from '@/services/admin'
import type { WorkType } from '@/entities/workType/types'
import { nav } from '@/shared/i18n/ru'
import { ActiveNameDictionaryPage } from './components/ActiveNameDictionaryPage'

export function WorkTypesPage() {
  return (
    <ActiveNameDictionaryPage<WorkType>
      title={nav.adminWorkTypes}
      subtitle="Справочник видов работ"
      emptyTitle="Видов работ пока нет"
      modalCreateTitle="Новый вид работ"
      modalEditTitle="Изменить вид работ"
      successCreated="Вид работ создан"
      successUpdated="Вид работ обновлён"
      fieldPlaceholder="Монолитные работы"
      list={listWorkTypes}
      create={createWorkType}
      update={updateWorkType}
      setActive={setWorkTypeActive}
    />
  )
}
