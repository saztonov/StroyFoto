import { PageHeader } from '@/shared/ui/PageHeader'
import { EmptySection } from '@/shared/ui/EmptySection'
import { emptyStates, nav } from '@/shared/i18n/ru'

export function ProjectsPage() {
  return (
    <>
      <PageHeader title={nav.adminProjects} subtitle="Справочник проектов" />
      <EmptySection title={emptyStates.noProjects} description={emptyStates.soon} />
    </>
  )
}
