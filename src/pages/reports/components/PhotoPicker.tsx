import { memo, useEffect, useMemo, useState } from 'react'
import { Button, Flex, Spin, Typography, message } from 'antd'
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
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.04)',
      }}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
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

export function PhotoPicker({ value, onChange }: Props) {
  const [busy, setBusy] = useState(false)

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
    try {
      const added: DraftPhoto[] = []
      // Последовательная обработка: щадим CPU мобильного устройства.
      for (const file of files) {
        try {
          const compressed = await imageCompression(file, {
            maxSizeMB: 1.5,
            maxWidthOrHeight: 2048,
            useWebWorker: true,
            initialQuality: 0.85,
          })
          const thumb = await imageCompression(file, {
            maxSizeMB: 0.1,
            maxWidthOrHeight: 320,
            useWebWorker: true,
            initialQuality: 0.7,
          })
          const dims = await readDimensions(compressed)
          added.push({
            id: uuid(),
            blob: compressed,
            thumbBlob: thumb,
            width: dims.width,
            height: dims.height,
            takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          })
        } catch (e) {
          console.error('photo compress failed', e)
          message.error(`Не удалось обработать файл: ${file.name}`)
        }
      }
      if (added.length > 0) onChange([...value, ...added])
    } finally {
      setBusy(false)
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
            <Typography.Text type="secondary">Сжимаем фотографии…</Typography.Text>
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
