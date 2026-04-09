import { useEffect, useRef, useState } from 'react'
import { Button, Flex, Spin, Typography, message } from 'antd'
import { CameraOutlined, DeleteOutlined, PictureOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import imageCompression from 'browser-image-compression'
import { v4 as uuid } from 'uuid'

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

export function PhotoPicker({ value, onChange }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const p of value) {
      next[p.id] = previews[p.id] ?? URL.createObjectURL(p.thumbBlob)
    }
    // Освобождаем URL-ы удалённых элементов.
    for (const id of Object.keys(previews)) {
      if (!next[id]) URL.revokeObjectURL(previews[id])
    }
    setPreviews(next)
    return () => {
      // unmount cleanup происходит в отдельном эффекте ниже
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    return () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      const added: DraftPhoto[] = []
      for (const file of Array.from(files)) {
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
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
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
        <Button
          icon={<CameraOutlined />}
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
        >
          Снять фото
        </Button>
        <Button
          icon={<PictureOutlined />}
          onClick={() => galleryRef.current?.click()}
          disabled={busy}
        >
          Из галереи
        </Button>
        {busy ? (
          <Flex align="center" gap={8}>
            <Spin size="small" />
            <Typography.Text type="secondary">Сжимаем фотографии…</Typography.Text>
          </Flex>
        ) : null}
      </Flex>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {value.length === 0 ? (
        <Typography.Text type="secondary">Фотографии ещё не добавлены</Typography.Text>
      ) : (
        <Flex gap={8} wrap="wrap">
          {value.map((p, idx) => (
            <div
              key={p.id}
              style={{
                position: 'relative',
                width: 110,
                height: 110,
                borderRadius: 8,
                overflow: 'hidden',
                background: 'rgba(0,0,0,0.04)',
              }}
            >
              <img
                src={previews[p.id]}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <Flex
                gap={4}
                style={{
                  position: 'absolute',
                  left: 4,
                  bottom: 4,
                }}
              >
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                />
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  onClick={() => move(idx, 1)}
                  disabled={idx === value.length - 1}
                />
              </Flex>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeAt(p.id)}
                style={{ position: 'absolute', top: 4, right: 4 }}
              />
            </div>
          ))}
        </Flex>
      )}
    </Flex>
  )
}
