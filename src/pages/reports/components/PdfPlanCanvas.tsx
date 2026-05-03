import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Spin } from 'antd'

import * as pdfjsLib from 'pdfjs-dist'
// Плагин pdfjsWorkerFix в vite.config.ts эмитирует worker как .js-ассет
// и подставляет URL через виртуальный модуль 'virtual:pdfjs-worker'.
// @ts-expect-error virtual module resolved by Vite plugin
import pdfWorkerUrl from 'virtual:pdfjs-worker'

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
}

export interface PdfPoint {
  xNorm: number
  yNorm: number
}

interface Props {
  /** Бинарник PDF. Обычно приходит из `plans_cache` или `downloadPlanPdf`. */
  blob: Blob | null
  /** 1-based номер страницы. */
  page: number
  /** Существующая отметка (нормализованные координаты внутри страницы). */
  value: PdfPoint | null
  /** Если задан — клики по canvas включены и передают новые координаты. */
  onPick?: (p: PdfPoint) => void
  /** Сообщает родителю число страниц, как только PDF открыт. */
  onPageCountReady?: (n: number) => void
  /** Максимальная ширина холста в пикселях (для мобильного адаптива). */
  maxWidth?: number
}

/**
 * Базовый рендер PDF-страницы в <canvas> с поддержкой клика-постановки точки
 * и read-only отображения. Используется и на форме создания отчёта, и в
 * детальной странице. PDF рендерится офскрин через pdf.js worker; основной
 * поток остаётся свободным.
 */
export function PdfPlanCanvas({
  blob,
  page,
  value,
  onPick,
  onPageCountReady,
  maxWidth = 900,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  // Текущая измеренная ширина контейнера. Меняется при повороте экрана,
  // открытии/закрытии клавиатуры, ресайзе модалки. Используется как зависимость
  // основного эффекта рендера, чтобы PDF перерисовывался под новую ширину.
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastWidth = 0
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      if (w === lastWidth || w === 0) return
      lastWidth = w
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setContainerWidth(w), 150)
    })
    ro.observe(wrapper)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Переконвертируем Blob в ArrayBuffer один раз на blob — иначе pdf.js
  // ест память на каждый ререндер при одном и том же файле.
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  useEffect(() => {
    if (!blob) {
      setBytes(null)
      return
    }
    let cancelled = false
    void blob.arrayBuffer().then((buf) => {
      if (!cancelled) setBytes(new Uint8Array(buf))
    })
    return () => {
      cancelled = true
    }
  }, [blob])

  useEffect(() => {
    if (!bytes) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const run = async () => {
      try {
        // copy нужен, потому что pdf.js забирает владение массивом
        // и при повторном getDocument падает "neutered ArrayBuffer".
        const task = pdfjsLib.getDocument({ data: bytes.slice() })
        const doc = await task.promise
        if (cancelled) {
          doc.destroy()
          return
        }
        onPageCountReady?.(doc.numPages)
        const targetPage = Math.max(1, Math.min(page, doc.numPages))
        const pdfPage = await doc.getPage(targetPage)
        if (cancelled) {
          doc.destroy()
          return
        }

        const canvas = canvasRef.current
        const wrapper = wrapperRef.current
        if (!canvas || !wrapper) {
          doc.destroy()
          return
        }
        const measured = wrapper.getBoundingClientRect().width || maxWidth
        const targetWidth = Math.min(maxWidth, measured)
        const baseViewport = pdfPage.getViewport({ scale: 1 })
        const scale = targetWidth / baseViewport.width
        const viewport = pdfPage.getViewport({ scale })

        // Cap DPR=2: на iPhone 14 Pro DPR=3 даёт x9 пикселей на canvas
        // (~9 МБ памяти на страницу плана) без заметного выигрыша по чёткости.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          doc.destroy()
          return
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const renderTask = pdfPage.render({ canvasContext: ctx, viewport, canvas })
        renderTaskRef.current = renderTask
        await renderTask.promise
        if (cancelled) {
          doc.destroy()
          return
        }
        setRenderedSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) })
        doc.destroy()
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      try {
        renderTaskRef.current?.cancel()
      } catch {
        // ignore
      }
    }
  }, [bytes, page, maxWidth, onPageCountReady, containerWidth])

  const pointStyle = useMemo(() => {
    if (!value || !renderedSize) return null
    const left = value.xNorm * renderedSize.w
    const top = value.yNorm * renderedSize.h
    return { left, top }
  }, [value, renderedSize])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick || !renderedSize) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xNorm = (e.clientX - rect.left) / rect.width
    const yNorm = (e.clientY - rect.top) / rect.height
    if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return
    onPick({ xNorm, yNorm })
  }

  if (!blob) return null

  return (
    <div ref={wrapperRef} style={{ position: 'relative', maxWidth }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          <Spin />
        </div>
      )}
      {error && <Alert type="error" showIcon message="Не удалось открыть PDF" description={error} />}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          display: 'block',
          maxWidth: '100%',
          borderRadius: 6,
          background: '#ffffff',
          boxShadow: '0 0 0 1px var(--ant-color-border)',
          cursor: onPick ? 'crosshair' : 'default',
          touchAction: 'manipulation',
        }}
      />
      {pointStyle && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: pointStyle.left,
            top: pointStyle.top,
            width: 18,
            height: 18,
            marginLeft: -9,
            marginTop: -9,
            borderRadius: '50%',
            background: '#ff4d4f',
            boxShadow: '0 0 0 3px rgba(255,77,79,0.25)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
