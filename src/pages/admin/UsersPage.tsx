import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { emptyStates, nav } from '@/shared/i18n/ru'

export function UsersPage() {
  return (
    <>
      <PageHeader
        title={nav.adminUsers}
        subtitle="Активация, ФИО, роли, назначение проектов"
      />
      <EmptySection title={emptyStates.noUsers} description={emptyStates.soon} />
    </>
  )
}
