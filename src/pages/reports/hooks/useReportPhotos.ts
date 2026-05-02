import { useEffect, useMemo, useRef, useState } from 'react'
import { cacheRemotePhotoBlob, getCachedRemotePhotoBlob } from '@/services/reports'
import { requestPresigned } from '@/services/objectStorage'
import type { DisplayPhoto, LoadedReport } from '../types'

interface Result {
  localDisplayPhotos: DisplayPhoto[]
  remotePhotoUrls: DisplayPhoto[]
  remotePhotosLoading: boolean
}

/**
 * Управляет ObjectURL'ами фото для рендера и предзагрузкой remote-фото
 * через presigned GET с кэшированием blob в IDB (origin='remote').
 * Гарантирует cleanup всех созданных URL при размонтировании.
 */
export function useReportPhotos(data: LoadedReport | null): Result {
  const objectUrlsRef = useRef<string[]>([])
  const [remotePhotoUrls, setRemotePhotoUrls] = useState<DisplayPhoto[]>([])
  const [remotePhotosLoading, setRemotePhotosLoading] = useState(false)

  // Локальные фото → object URLs
  const localDisplayPhotos = useMemo<DisplayPhoto[]>(() => {
    if (!data?.localPhotos) return []
    // Очищаем предыдущие
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
    objectUrlsRef.current = []
    const list = data.localPhotos.map<DisplayPhoto>((p) => {
      // thumbBlob может быть null для remote-кэша; тогда показываем полный blob как превью.
      const thumbUrl = URL.createObjectURL(p.thumbBlob ?? p.blob)
      const fullUrl = URL.createObjectURL(p.blob)
      objectUrlsRef.current.push(thumbUrl, fullUrl)
      return { id: p.id, thumbUrl, fullUrl, width: p.width ?? null, height: p.height ?? null }
    })
    return list
  }, [data?.localPhotos])

  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u)
      objectUrlsRef.current = []
    }
  }, [])

  // Remote-only фото: сначала пытаемся взять blob из IDB-кэша, иначе качаем
  // через presigned GET, кладём в IDB (origin='remote') и делаем object URL.
  // Такой порядок даёт honest offline: второе открытие отчёта работает без сети.
  useEffect(() => {
    if (!data?.remotePhotos) {
      setRemotePhotoUrls([])
      setRemotePhotosLoading(false)
      return
    }
    let cancelled = false
    const createdUrls: string[] = []
    setRemotePhotoUrls([])
    setRemotePhotosLoading(true)
    void (async () => {
      const out: DisplayPhoto[] = []
      try {
        for (const p of data.remotePhotos!) {
          try {
            const cached = await getCachedRemotePhotoBlob(p.id)
            if (cached && cached.blob) {
              const thumbUrl = URL.createObjectURL(cached.thumbBlob ?? cached.blob)
              const fullUrl = URL.createObjectURL(cached.blob)
              createdUrls.push(thumbUrl, fullUrl)
              out.push({ id: p.id, thumbUrl, fullUrl, width: p.width ?? null, height: p.height ?? null })
              if (!cancelled) setRemotePhotoUrls([...out])
              continue
            }
            const online = typeof navigator === 'undefined' ? true : navigator.onLine
            if (!online) continue

            const [thumbPre, fullPre] = await Promise.all([
              requestPresigned({
                op: 'get',
                kind: 'photo_thumb',
                key: p.thumb_object_key,
                reportId: data.card.id,
              }),
              requestPresigned({
                op: 'get',
                kind: 'photo',
                key: p.object_key,
                reportId: data.card.id,
              }),
            ])
            const [fullResp, thumbResp] = await Promise.all([
              fetch(fullPre.url),
              fetch(thumbPre.url),
            ])
            if (!fullResp.ok) throw new Error(`photo ${p.id}: ${fullResp.status}`)
            const fullBlob = await fullResp.blob()
            const thumbBlob = thumbResp.ok ? await thumbResp.blob() : null
            await cacheRemotePhotoBlob(data.card.id, p.id, fullBlob, thumbBlob)
            const thumbUrl = URL.createObjectURL(thumbBlob ?? fullBlob)
            const fullUrl = URL.createObjectURL(fullBlob)
            createdUrls.push(thumbUrl, fullUrl)
            out.push({ id: p.id, thumbUrl, fullUrl, width: p.width ?? null, height: p.height ?? null })
            if (!cancelled) setRemotePhotoUrls([...out])
          } catch {
            // пропускаем — будет placeholder
          }
        }
        if (cancelled) {
          for (const u of createdUrls) URL.revokeObjectURL(u)
          return
        }
        setRemotePhotoUrls(out)
        objectUrlsRef.current.push(...createdUrls)
      } finally {
        if (!cancelled) setRemotePhotosLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data?.remotePhotos, data?.card.id])

  return { localDisplayPhotos, remotePhotoUrls, remotePhotosLoading }
}
