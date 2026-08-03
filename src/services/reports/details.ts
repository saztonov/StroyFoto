import { apiFetch, ApiError } from '@/lib/apiClient'
import { cacheRemoteSnapshot } from './cache'
import { fromRemote } from './mappers'
import { splitRemoteMarks } from './marks'
import type { RemoteReportFull, RemoteReportRowWithNested } from './types'

interface ServerReportFull extends RemoteReportRowWithNested {
  author_name: string | null
}

/**
 * Загружает один отчёт с сервера со всеми вложенными фото и меткой плана
 * и записывает полный snapshot в `remote_reports_cache` для офлайна.
 * Имя автора приходит сразу в ответе (поле `author_name`) — отдельный
 * запрос не нужен.
 */
export async function loadRemoteReportById(
  id: string,
): Promise<RemoteReportFull | null> {
  let data: ServerReportFull
  try {
    const resp = await apiFetch<{ report: ServerReportFull }>(
      `/api/reports/${id}`,
    )
    data = resp.report
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }

  const row = data
  const authorName = row.author_name ?? null
  const photos = row.report_photos ?? []
  // Сервер отдаёт легаси-метку и точки фотографий одним массивом; разбираем
  // явно, а не по индексу [0], как это делал прежний код.
  const { legacy: mark, photoMarks } = splitRemoteMarks(row.report_plan_marks)

  await cacheRemoteSnapshot({
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
    workTypeName: row.work_type_name ?? null,
    workAssignmentName: row.work_assignment_name ?? null,
    performers: row.performers ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    cachedAt: Date.now(),
    photos: photos.map((p) => ({
      id: p.id,
      objectKey: p.object_key,
      thumbObjectKey: p.thumb_object_key,
      width: p.width,
      height: p.height,
      takenAt: p.taken_at,
    })),
    mark: mark
      ? { planId: mark.plan_id, page: mark.page, xNorm: mark.x_norm, yNorm: mark.y_norm }
      : null,
    // Без этого офлайн-история показывала бы только легаси-метку: одной
    // сменой updated_at точки в снапшоте не обновляются.
    marks: photoMarks.map((m) => ({
      photoId: m.photo_id!,
      planId: m.plan_id,
      page: m.page,
      xNorm: m.x_norm,
      yNorm: m.y_norm,
    })),
    photoMarksVersion: row.photo_marks_version ?? undefined,
  })

  return {
    card: fromRemote(row, authorName),
    photos,
    mark,
    photoMarks,
    authorName,
  }
}
