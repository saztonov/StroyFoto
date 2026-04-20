import { memo, useEffect, useMemo, useState } from 'react'
import { App, Button, Flex, Spin, Tag, Typography } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CameraOutlined,
  DeleteOutlined,
  PictureOutlined,
} from '@ant-design/icons'
import imageCompression from 'browser-image-compression'
import { v4 as uuid } from 'uuid'
import { platform } from '@/lib/platform'
import { isPanoramaByRatio } from '@/shared/lib/isPanorama'
import { photo360 } from '@/shared/i18n/ru'

export interface DraftPhoto {
  id: string
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  takenAt: string | null
}

interface Props {
  value: DraftPhoto[]
  onChange: (next: DraftPhoto[]) => void
}

async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = reject
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface PhotoTileProps {
  photo: DraftPhoto
  url: string
  index: number
  total: number
  onMove: (idx: number, delta: number) => void
  onRemove: (id: string) => void
}

const PhotoTile = memo(function PhotoTile({
  photo,
  url,
  index,
  total,
  onMove,
  onRemove,
}: PhotoTileProps) {
  const isPano = isPanoramaByRatio(photo.width, photo.height)
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--ant-color-fill-quaternary)',
      }}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {isPano && (
        <Tag
          color="blue"
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            margin: 0,
            fontSize: 11,
            lineHeight: '16px',
            padding: '0 6px',
          }}
        >
          {photo360.badge}
        </Tag>
      )}
      <Flex gap={4} style={{ position: 'absolute', left: 4, bottom: 4 }}>
        <Button
          size="small"
          icon={<ArrowUpOutlined />}
          onClick={() => onMove(index, -1)}
          disabled={index === 0}
        />
        <Button
          size="small"
          icon={<ArrowDownOutlined />}
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1}
        />
      </Flex>
      <Button
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={() => onRemove(photo.id)}
        style={{ position: 'absolute', top: 4, right: 4 }}
      />
    </div>
  )
})

const COMPRESS_CONCURRENCY = 2

export function PhotoPicker({ value, onChange }: Props) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // Стабильная карта id → object URL. URL живёт ровно столько, сколько фото в value.
  const previews = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of value) map.set(p.id, URL.createObjectURL(p.thumbBlob))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url)
    }
  }, [previews])

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: files.length })
    try {
      const added: DraftPhoto[] = []
      let done = 0

      const processOne = async (file: File): Promise<DraftPhoto | null> => {
        try {
          // Предварительно читаем размеры исходника, чтобы определить 360°-панораму
          // и сохранить её в более высоком разрешении. Thumb всегда делаем 320 px.
          const srcDims = await readDimensions(file).catch(() => ({ width: 0, height: 0 }))
          const isPano = isPanoramaByRatio(srcDims.width, srcDims.height)
          const compressed = await imageCompression(file, {
            maxSizeMB: isPano ? 5 : 1.5,
            maxWidthOrHeight: isPano ? 8192 : 2048,
            useWebWorker: true,
            initialQuality: 0.85,
          })
          // Превью из уже сжатого файла — значительно быстрее, чем из оригинала.
          const thumbFile = new File([compressed], file.name, { type: compressed.type })
          const thumb = await imageCompression(thumbFile, {
            maxSizeMB: 0.1,
            maxWidthOrHeight: 320,
            useWebWorker: true,
            initialQuality: 0.7,
          })
          const dims = await readDimensions(compressed)
          return {
            id: uuid(),
            blob: compressed,
            thumbBlob: thumb,
            width: dims.width,
            height: dims.height,
            takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          }
        } catch (e) {
          console.error('photo compress failed', e)
          message.error(`Не удалось обработать файл: ${file.name}`)
          return null
        } finally {
          done++
          setProgress({ done, total: files.length })
        }
      }

      // Параллельная обработка с ограничением конкурентности.
      const executing = new Set<Promise<void>>()
      for (const file of files) {
        const p = processOne(file).then((r) => {
          if (r) added.push(r)
          executing.delete(p)
        })
        executing.add(p)
        if (executing.size >= COMPRESS_CONCURRENCY) await Promise.race(executing)
      }
      await Promise.all(executing)

      if (added.length > 0) onChange([...value, ...added])
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const takePhoto = async () => {
    const files = await platform.camera.takePhoto()
    await handleFiles(files)
  }
  const pickGallery = async () => {
    const files = await platform.camera.pickFromGallery()
    await handleFiles(files)
  }

  const removeAt = (id: string) => onChange(value.filter((p) => p.id !== id))
  const move = (idx: number, delta: number) => {
    const next = [...value]
    const target = idx + delta
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }

  return (
    <Flex vertical gap={12}>
      <Flex gap={8} wrap="wrap">
        <Button icon={<CameraOutlined />} onClick={() => void takePhoto()} disabled={busy}>
          Снять фото
        </Button>
        <Button icon={<PictureOutlined />} onClick={() => void pickGallery()} disabled={busy}>
          Из галереи
        </Button>
        {busy ? (
          <Flex align="center" gap={8}>
            <Spin size="small" />
            <Typography.Text type="secondary">
              Сжимаем фотографии…{progress ? ` ${progress.done}/${progress.total}` : ''}
            </Typography.Text>
          </Flex>
        ) : null}
      </Flex>

      {value.length === 0 ? (
        <Typography.Text type="secondary">Фотографии ещё не добавлены</Typography.Text>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
            gap: 8,
          }}
        >
          {value.map((p, idx) => (
            <PhotoTile
              key={p.id}
              photo={p}
              url={previews.get(p.id) ?? ''}
              index={idx}
              total={value.length}
              onMove={move}
              onRemove={removeAt}
            />
          ))}
        </div>
      )}
    </Flex>
  )
}
