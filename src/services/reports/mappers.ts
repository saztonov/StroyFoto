import type { LocalReport, RemoteReportSnapshot } from '@/lib/db'
import type { ReportCard, RemoteReportRow } from './types'

export function fromLocal(r: LocalReport): ReportCard {
  return {
    id: r.id,
    projectId: r.projectId,
    workTypeId: r.workTypeId,
    performerId: r.performerId,
    workAssignmentId: r.workAssignmentId ?? null,
    planId: r.planId,
    description: r.description,
    takenAt: r.takenAt,
    authorId: r.authorId,
    authorName: null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? null,
    syncStatus: r.syncStatus,
    remoteOnly: false,
    lastError: r.lastError,
  }
}

export function fromRemote(row: RemoteReportRow, authorName: string | null = null): ReportCard {
  return {
    id: row.id,
    projectId: row.project_id,
    workTypeId: row.work_type_id,
    performerId: row.performer_id,
    workAssignmentId: row.work_assignment_id ?? null,
    planId: row.plan_id,
    description: row.description,
    takenAt: row.taken_at,
    authorId: row.author_id,
    authorName,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    syncStatus: 'synced',
    remoteOnly: true,
  }
}

export function fromSnapshot(s: RemoteReportSnapshot): ReportCard {
  return {
    id: s.id,
    projectId: s.projectId,
    workTypeId: s.workTypeId,
    performerId: s.performerId,
    workAssignmentId: s.workAssignmentId ?? null,
    planId: s.planId,
    description: s.description,
    takenAt: s.takenAt,
    authorId: s.authorId,
    authorName: s.authorName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? null,
    syncStatus: 'synced',
    remoteOnly: true,
  }
}
