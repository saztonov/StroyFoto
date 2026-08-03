import type { LocalPhoto, LocalPhotoMark } from '@/lib/db'
import type { ReportCard, RemoteReportPhoto } from '@/services/reports'

export interface DisplayPhoto {
  id: string
  thumbUrl: string
  fullUrl: string
  width: number | null
  height: number | null
}

export interface LoadedReport {
  card: ReportCard
  localPhotos: LocalPhoto[] | null
  remotePhotos: RemoteReportPhoto[] | null
  /** Легаси-метка «одна общая на отчёт». */
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null
  /** Точки фотографий: по одной на 360-снимок. */
  photoMarks: LocalPhotoMark[]
  authorName: string | null
}
