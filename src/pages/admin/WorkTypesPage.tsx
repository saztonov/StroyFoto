import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { emptyStates, nav } from '@/shared/i18n/ru'

export function WorkTypesPage() {
  return (
    <>
      <PageHeader title={nav.adminWorkTypes} subtitle="Справочник видов работ" />
      <EmptySection title={emptyStates.noWorkTypes} description={emptyStates.soon} />
    </>
  )
}
