import imageCompression from 'browser-image-compression'
import { isPanoramaByRatio } from '@/shared/lib/isPanorama'

export interface Size {
  width: number
  height: number
}

export interface CompressProfile {
  /** Предел длинной стороны, px. */
  maxSide: number
  /** Целевой размер файла. Мягкий: результат крупнее принимается как есть. */
  maxSizeMB: number
  /** Стартовое качество JPEG. */
  quality: number
  /** При превышении maxSizeMB снижать только качество, но не разрешение. */
  keepResolution: boolean
}

/**
 * Обычные фото. Для фотоконтроля важнее разрешение (мелкая маркировка,
 * надписи), поэтому при превышении веса библиотека снижает только качество.
 */
export const PHOTO_PROFILE: CompressProfile = {
  maxSide: 3072,
  maxSizeMB: 3,
  quality: 0.9,
  keepResolution: true,
}

/** 360°-панорамы — параметры прежние, основной файл всегда пересжимается. */
export const PANO_PROFILE: CompressProfile = {
  maxSide: 8192,
  maxSizeMB: 5,
  quality: 0.85,
  keepResolution: false,
}

/**
 * Превью везде показывается квадратной плиткой с object-fit: cover, поэтому
 * важна короткая сторона: 360 px закрывают плитку 120 CSS px на DPR 3.
 * Ограничение длинной стороны нужно только для очень вытянутых кадров.
 */
export const THUMB_SHORT_SIDE = 360
export const THUMB_MAX_LONG_SIDE = 1080
export const THUMB_QUALITY = 0.8

const MB = 1024 * 1024

export function pickProfile(width: number, height: number): CompressProfile {
  return isPanoramaByRatio(width, height) ? PANO_PROFILE : PHOTO_PROFILE
}

/**
 * JPEG, который уже укладывается в лимиты, не пересжимаем: повторное
 * кодирование уже сжатого файла (например, из мессенджера) только теряет
 * качество. Панорамы — всегда через пересжатие, как и раньше.
 */
export function canKeepOriginal(
  file: Pick<Blob, 'type' | 'size'>,
  dims: Size,
  profile: CompressProfile,
): boolean {
  if (profile !== PHOTO_PROFILE) return false
  if (file.type !== 'image/jpeg') return false
  if (dims.width <= 0 || dims.height <= 0) return false
  if (Math.max(dims.width, dims.height) > profile.maxSide) return false
  return file.size <= profile.maxSizeMB * MB
}

export function thumbSize(width: number, height: number): Size {
  const scale = Math.min(
    1,
    THUMB_SHORT_SIDE / Math.min(width, height),
    THUMB_MAX_LONG_SIDE / Math.max(width, height),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * План ступенчатого уменьшения: делим пополам, пока размер больше удвоенной
 * цели, затем последний шаг до цели. Уменьшение одним шагом в 5–10 раз теряет
 * детали при любом встроенном сглаживании canvas.
 */
export function downscaleSteps(width: number, height: number, target: Size): Size[] {
  const steps: Size[] = []
  let w = width
  let h = height
  while (w > target.width * 2 && h > target.height * 2) {
    w = Math.round(w / 2)
    h = Math.round(h / 2)
    steps.push({ width: w, height: h })
  }
  steps.push(target)
  return steps
}

export interface StrippedJpeg {
  bytes: Uint8Array<ArrayBuffer>
  /** EXIF Orientation; 1 — кадр не повёрнут или тега нет. */
  orientation: number
}

const EXIF_HEADER = 'Exif\0\0'
const XMP_HEADERS = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0']
const MARKER_APP1 = 0xe1
const MARKER_APP13 = 0xed
const MARKER_SOS = 0xda

function startsWithAscii(src: Uint8Array, offset: number, end: number, ascii: string): boolean {
  if (offset + ascii.length > end) return false
  for (let i = 0; i < ascii.length; i++) {
    if (src[offset + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/** Orientation из TIFF-структуры EXIF; -1 — структура битая. */
function readExifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return -1
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return -1
  const le = order === 0x4949
  const ifd = view.getUint32(4, le)
  if (ifd + 2 > tiff.length) return -1
  const count = view.getUint16(ifd, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return -1
    if (view.getUint16(entry, le) === 0x0112) return view.getUint16(entry + 8, le)
  }
  return 1
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Вырезает из JPEG метаданные без пересжатия: APP1 EXIF (модель телефона, GPS),
 * APP1 XMP и APP13 IPTC. Остальные сегменты — APP0, APP2 (ICC-профиль, MPF),
 * APP14, таблицы — и всё начиная с SOS копируются побайтно. Смещения MPF
 * отсчитываются от его собственного заголовка, удаление предыдущих сегментов
 * их не ломает.
 *
 * Заодно возвращает EXIF Orientation: после вырезания EXIF повёрнутый кадр
 * отобразился бы боком, такой файл нужно пересжимать.
 *
 * null — структура не похожа на корректный JPEG; тогда файл пересжимается.
 */
export function stripJpegMetadata(src: Uint8Array): StrippedJpeg | null {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return null
  const kept: Uint8Array[] = [src.subarray(0, 2)]
  let orientation: number | null = null
  let pos = 2
  while (pos < src.length) {
    if (src[pos] !== 0xff) return null
    // Перед маркером допускаются байты-заполнители 0xFF.
    while (pos + 1 < src.length && src[pos + 1] === 0xff) pos++
    if (pos + 1 >= src.length) return null
    const marker = src[pos + 1]
    if (marker === MARKER_SOS) {
      kept.push(src.subarray(pos))
      return { bytes: concat(kept), orientation: orientation ?? 1 }
    }
    // EOI раньше SOS — в файле нет изображения.
    if (marker === 0xd9) return null
    // TEM и RST не имеют длины. Остальные сегменты до SOS — с длиной.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(src.subarray(pos, pos + 2))
      pos += 2
      continue
    }
    if (pos + 4 > src.length) return null
    const length = (src[pos + 2] << 8) | src[pos + 3]
    const end = pos + 2 + length
    if (length < 2 || end > src.length) return null
    const payload = pos + 4
    if (marker === MARKER_APP1 && startsWithAscii(src, payload, end, EXIF_HEADER)) {
      if (orientation === null) {
        orientation = readExifOrientation(src.subarray(payload + EXIF_HEADER.length, end))
        if (orientation === -1) return null
      }
    } else if (
      !(marker === MARKER_APP1 && XMP_HEADERS.some((h) => startsWithAscii(src, payload, end, h))) &&
      marker !== MARKER_APP13
    ) {
      kept.push(src.subarray(pos, end))
    }
    pos = end
  }
  return null
}

async function readDimensions(blob: Blob): Promise<Size> {
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

/** iOS Safari медленно освобождает память canvas — обнуляем явно. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob вернул null'))),
      'image/jpeg',
      quality,
    )
  })
}

async function makeThumbnail(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  let canvas: HTMLCanvasElement | null = null
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const { naturalWidth: w, naturalHeight: h } = img
    let source: CanvasImageSource = img
    for (const step of downscaleSteps(w, h, thumbSize(w, h))) {
      const next = document.createElement('canvas')
      next.width = step.width
      next.height = step.height
      const ctx = next.getContext('2d')
      if (!ctx) throw new Error('canvas 2d недоступен')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source, 0, 0, step.width, step.height)
      if (canvas) releaseCanvas(canvas)
      canvas = next
      source = next
    }
    return await canvasToJpeg(canvas!, THUMB_QUALITY)
  } finally {
    if (canvas) releaseCanvas(canvas)
    URL.revokeObjectURL(url)
  }
}

export interface CompressedPhoto {
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
}

/**
 * Готовит фото к сохранению в IDB и загрузке: основной файл (оригинал без
 * метаданных либо пересжатый JPEG) и превью.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  // Размеры исходника нужны, чтобы распознать 360°-панораму и решить,
  // можно ли оставить файл без пересжатия.
  const srcDims = await readDimensions(file).catch(() => ({ width: 0, height: 0 }))
  const profile = pickProfile(srcDims.width, srcDims.height)

  if (canKeepOriginal(file, srcDims, profile)) {
    const stripped = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()))
    if (stripped && stripped.orientation === 1) {
      const blob = new Blob([stripped.bytes], { type: 'image/jpeg' })
      return { blob, thumbBlob: await makeThumbnail(blob), ...srcDims }
    }
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: profile.maxSizeMB,
    maxWidthOrHeight: profile.maxSide,
    initialQuality: profile.quality,
    alwaysKeepResolution: profile.keepResolution,
    fileType: 'image/jpeg',
    useWebWorker: true,
  })
  if (compressed.size > profile.maxSizeMB * MB) {
    // Лимит мягкий: фото не теряем и дополнительно не уменьшаем.
    console.warn(
      `photo ${file.name}: ${(compressed.size / MB).toFixed(2)} МБ после сжатия, цель ${profile.maxSizeMB} МБ`,
    )
  }
  const dims = await readDimensions(compressed)
  return { blob: compressed, thumbBlob: await makeThumbnail(compressed), ...dims }
}
