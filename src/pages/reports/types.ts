import type { LocalPhoto } from '@/lib/db'
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
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null
  authorName: string | null
}
