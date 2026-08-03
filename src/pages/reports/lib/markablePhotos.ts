import { useEffect, useRef, useState } from 'react'
import { isPanoramaByRatio } from '@/shared/lib/isPanorama'

/**
 * Фотография в том виде, в каком её понимает разметка плана.
 *
 * Единый адаптер нужен потому, что готового типа нет: у черновика (`DraftPhoto`)
 * есть `thumbBlob`, но нет URL; у уже сохранённой (`ExistingPhoto`) — наоборот,
 * URL без размеров. А размеры обязательны: по ним определяется сферичность.
 */
export interface MarkablePhoto {
  id: string
  thumbUrl: string
  width: number | null
  height: number | null
}

/** Точка ставится только сферическим снимкам — «1 точка = 1 фото 360». */
export function panoramaOnly(photos: MarkablePhoto[]): MarkablePhoto[] {
  return photos.filter((p) => isPanoramaByRatio(p.width, p.height))
}

/**
 * Object URL'ы для блобов с гарантированным отзывом.
 *
 * Прежний код в PhotoPicker создавал URL внутри useMemo и не отзывал их вовсе —
 * каждая пересборка списка оставляла повисшие ссылки на блобы, а это память на
 * устройстве, где и так следят за квотой IndexedDB.
 */
export function useBlobUrls(
  items: ReadonlyArray<{ id: string; blob: Blob }>,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  // Ключ по составу списка: идентичность самого массива меняется на каждый
  // рендер родителя, а пересоздавать URL нужно только при смене набора фото.
  const key = items.map((i) => i.id).join(' ')
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const map = new Map<string, string>()
    for (const it of itemsRef.current) map.set(it.id, URL.createObjectURL(it.blob))
    setUrls(map)
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
    }
  }, [key])

  return urls
}
