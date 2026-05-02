import { useCallback, useEffect, useState } from 'react'
import type { AuthSessionUser } from '@/app/providers/AuthProvider'
import { getDB } from '@/lib/db'
import { reportDetails } from '@/shared/i18n/ru'
import { getLocalReport, getPhotosForReport } from '@/services/localReports'
import {
  loadCachedRemoteReport,
  loadRemoteReportById,
  purgeLocalReportData,
  type RemoteReportFull,
} from '@/services/reports'
import { onReportChanged } from '@/services/invalidation'
import type { Profile } from '@/entities/profile/types'
import type { LoadedReport } from '../types'

interface Result {
  data: LoadedReport | null
  loading: boolean
  error: string | null
  offlineUnavailable: boolean
  refresh: () => void
  setData: (next: LoadedReport | null) => void
}

/**
 * Загружает отчёт по id (сначала локальный черновик, потом remote с fallback
 * на IDB-кэш) и подписывается на realtime-изменения именно этого отчёта.
 */
export function useReportData(id: string | undefined, user: AuthSessionUser | null, profile: Profile | null): Result {
  const [data, setData] = useState<LoadedReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offlineUnavailable, setOfflineUnavailable] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setOfflineUnavailable(false)

    const run = async () => {
      try {
        const local = await getLocalReport(id)
        if (local) {
          const photos = await getPhotosForReport(local.id)
          const db = await getDB()
          const mark = await db.get('plan_marks', local.id)
          if (cancelled) return
          setData({
            card: {
              id: local.id,
              projectId: local.projectId,
              workTypeId: local.workTypeId,
              performerId: local.performerId,
              workAssignmentId: local.workAssignmentId ?? null,
              planId: local.planId,
              description: local.description,
              takenAt: local.takenAt,
              authorId: local.authorId,
              authorName: local.authorId === user?.id ? profile?.full_name ?? null : null,
              createdAt: local.createdAt,
              updatedAt: local.updatedAt ?? null,
              syncStatus: local.syncStatus,
              remoteOnly: false,
            },
            localPhotos: photos.filter((p) => p.origin !== 'remote'),
            remotePhotos: null,
            mark: mark
              ? { planId: mark.planId, page: mark.page, xNorm: mark.xNorm, yNorm: mark.yNorm }
              : null,
            authorName: local.authorId === user?.id ? profile?.full_name ?? null : null,
          })
          setLoading(false)
          return
        }

        const online = typeof navigator === 'undefined' ? true : navigator.onLine
        let remote: RemoteReportFull | null = null
        if (online) {
          try {
            remote = await loadRemoteReportById(id)
            if (!remote) {
              // Онлайн-запрос успешен, но отчёт не найден → удалён другим
              // пользователем или доступ отозван. Чистим stale кэш.
              await purgeLocalReportData(id)
              if (cancelled) return
              setError('Отчёт удалён или недоступен')
              setLoading(false)
              return
            }
          } catch {
            // Сетевая ошибка — fallback на IDB-кэш
            remote = await loadCachedRemoteReport(id)
          }
        } else {
          // Офлайн — только кэш
          remote = await loadCachedRemoteReport(id)
        }
        if (cancelled) return
        if (!remote) {
          if (!online) setOfflineUnavailable(true)
          else setError(reportDetails.notFound)
          setLoading(false)
          return
        }
        setData({
          card: remote.card,
          localPhotos: null,
          remotePhotos: remote.photos,
          mark: remote.mark
            ? {
                planId: remote.mark.plan_id,
                page: remote.mark.page,
                xNorm: remote.mark.x_norm,
                yNorm: remote.mark.y_norm,
              }
            : null,
          authorName: remote.authorName,
        })
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id, user?.id, profile?.full_name, refreshCounter])

  // Подписка на изменения этого отчёта от других пользователей/вкладок
  useEffect(() => {
    if (!id) return
    const unsub = onReportChanged(id, (event) => {
      if (event === 'delete') {
        setError('Отчёт был удалён другим пользователем')
        setData(null)
      } else {
        // update — перезагружаем данные
        refresh()
      }
    })
    return unsub
  }, [id, refresh])

  return { data, loading, error, offlineUnavailable, refresh, setData }
}
