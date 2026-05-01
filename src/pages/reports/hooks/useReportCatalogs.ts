import { useEffect, useState } from 'react'
import {
  loadPerformers,
  loadPlansForProject,
  loadProjectsForUser,
  loadWorkAssignments,
  loadWorkTypes,
  type PlanRow,
} from '@/services/catalogs'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'

interface Result {
  projects: Project[]
  workTypes: WorkType[]
  performers: Performer[]
  workAssignments: WorkAssignment[]
  plans: PlanRow[]
  setWorkTypes: React.Dispatch<React.SetStateAction<WorkType[]>>
  setWorkAssignments: React.Dispatch<React.SetStateAction<WorkAssignment[]>>
}

/**
 * Подтягивает справочники (включая планы конкретного проекта). Сеттеры для
 * workTypes/workAssignments экспортируются ради onCreated-колбеков
 * EditReportModal, которые добавляют свежесозданный элемент мгновенно.
 */
export function useReportCatalogs(projectId: string | null | undefined): Result {
  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [performers, setPerformers] = useState<Performer[]>([])
  const [workAssignments, setWorkAssignments] = useState<WorkAssignment[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])

  useEffect(() => {
    void loadProjectsForUser().then(setProjects).catch(() => undefined)
    void loadWorkTypes().then(setWorkTypes).catch(() => undefined)
    void loadPerformers().then(setPerformers).catch(() => undefined)
    void loadWorkAssignments().then(setWorkAssignments).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!projectId) return
    void loadPlansForProject(projectId).then(setPlans).catch(() => undefined)
  }, [projectId])

  return { projects, workTypes, performers, workAssignments, plans, setWorkTypes, setWorkAssignments }
}
