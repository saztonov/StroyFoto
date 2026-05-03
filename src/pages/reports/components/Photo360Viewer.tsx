import { useEffect, useRef, useState } from 'react'
import { Button, Modal, Spin, Typography } from 'antd'
import { photo360 } from '@/shared/i18n/ru'

interface Props {
  open: boolean
  src: string | null
  onClose: () => void
  onFallback?: () => void
}

export function Photo360Viewer({ open, src, onClose, onFallback }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<{ destroy: () => void } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !src) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        // CSS грузим вместе с core-модулем — Vite положит её в тот же vendor-360
        // chunk, без этого PSV не может корректно отрисовать лоадер/прогресс
        // (в консоли ругается «stylesheet is not loaded» и валит SVG с NaN).
        const [mod] = await Promise.all([
          import('@photo-sphere-viewer/core'),
          import('@photo-sphere-viewer/core/index.css'),
        ])
        if (cancelled || !containerRef.current) return
        const viewer = new mod.Viewer({
          container: containerRef.current,
          panorama: src,
          navbar: ['zoom', 'move', 'fullscreen'],
          loadingImg: undefined,
          defaultZoomLvl: 0,
        })
        viewerRef.current = viewer
        viewer.addEventListener('ready', () => {
          if (!cancelled) setLoading(false)
        }, { once: true })
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy()
        } catch {
          // ignore
        }
        viewerRef.current = null
      }
    }
  }, [open, src])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{ top: 0, maxWidth: '100vw', paddingBottom: 0 }}
      styles={{
        content: { padding: 0, background: '#000', height: '100dvh' },
        body: { padding: 0, height: '100dvh' },
      }}
      closable
      destroyOnHidden
      maskClosable
      title={null}
      centered={false}
    >
      <div style={{ position: 'relative', width: '100%', height: '100dvh', background: '#000' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: '#fff',
              pointerEvents: 'none',
            }}
          >
            <Spin />
            <Typography.Text style={{ color: '#fff' }}>{photo360.loading}</Typography.Text>
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              padding: 16,
              textAlign: 'center',
            }}
          >
            <Typography.Text style={{ color: '#fff' }}>
              {photo360.loadError}: {error}
            </Typography.Text>
          </div>
        )}
        {onFallback && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 2 }}>
            <Button size="small" onClick={onFallback}>
              {photo360.fallback}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
