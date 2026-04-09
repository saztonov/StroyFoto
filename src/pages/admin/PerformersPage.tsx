import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { emptyStates, nav } from '@/shared/i18n/ru'

export function PerformersPage() {
  return (
    <>
      <PageHeader
        title={nav.adminPerformers}
        subtitle="Подрядчики и собственные силы"
      />
      <EmptySection title={emptyStates.noPerformers} description={emptyStates.soon} />
    </>
  )
}
