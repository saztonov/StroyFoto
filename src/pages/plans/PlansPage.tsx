import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { emptyStates, nav } from '@/shared/i18n/ru'

export function PlansPage() {
  return (
    <>
      <PageHeader title={nav.plans} subtitle="PDF-планы по проектам" />
      <EmptySection title={emptyStates.noPlans} description={emptyStates.soon} />
    </>
  )
}
