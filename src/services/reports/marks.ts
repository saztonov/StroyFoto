import type { LocalPhotoMark, LocalPlanMark, RemoteReportSnapshot } from '@/lib/db'
import type { RemoteReportMark } from './types'

/**
 * Разбор объединённого агрегата `report_plan_marks` из ответа сервера.
 *
 * Сервер отдаёт одним массивом легаси-метку отчёта (`photo_id === null`) и
 * точки фотографий, легаси всегда первой — на этот порядок опирается старый
 * клиент, читающий `[0]`. Здесь их разделяем явно.
 *
 * Ответ сервера до релиза поля `photo_id` не содержит вовсе: тогда весь массив
 * трактуется как легаси, и точек фотографий просто нет.
 */
export function splitRemoteMarks(rows: RemoteReportMark[] | null | undefined): {
  legacy: RemoteReportMark | null
  photoMarks: RemoteReportMark[]
} {
  const all = rows ?? []
  const legacy = all.find((m) => !m.photo_id) ?? null
  const photoMarks = all.filter((m): m is RemoteReportMark & { photo_id: string } =>
    Boolean(m.photo_id),
  )
  return { legacy, photoMarks }
}

/**
 * Точки фотографий из локальной записи. Записи, созданные до релиза, поля
 * `marks` не имеют — у них есть только легаси-метка, и точек фото нет.
 * Держим фолбэк в одном месте, чтобы `?? []` не расползался по коду.
 */
export function localPhotoMarks(
  rec: Pick<LocalPlanMark, 'marks'> | null | undefined,
): LocalPhotoMark[] {
  return rec?.marks ?? []
}

/** То же для снапшота серверного отчёта в офлайн-кэше. */
export function snapshotPhotoMarks(
  snap: Pick<RemoteReportSnapshot, 'marks'> | null | undefined,
): LocalPhotoMark[] {
  return snap?.marks ?? []
}

/** Точка конкретного фото, если она есть. */
export function photoMarkOf(
  marks: LocalPhotoMark[],
  photoId: string,
): LocalPhotoMark | null {
  return marks.find((m) => m.photoId === photoId) ?? null
}

/**
 * Дедупликация набора по photoId: первое вхождение выигрывает. Сервер делает
 * то же самое, но чинить набор до отправки дешевле, чем ловить конфликт.
 */
export function dedupePhotoMarks(marks: LocalPhotoMark[]): LocalPhotoMark[] {
  const seen = new Set<string>()
  return marks.filter((m) => {
    if (seen.has(m.photoId)) return false
    seen.add(m.photoId)
    return true
  })
}
