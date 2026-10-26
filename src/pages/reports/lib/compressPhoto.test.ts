import { describe, expect, it } from 'vitest'
import {
  PANO_PROFILE,
  PHOTO_PROFILE,
  canKeepOriginal,
  downscaleSteps,
  pickProfile,
  stripJpegMetadata,
  thumbSize,
} from '@/pages/reports/lib/compressPhoto'

const MB = 1024 * 1024

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2
  return [0xff, marker, len >> 8, len & 0xff, ...payload]
}

/** APP1 EXIF: TIFF-заголовок + IFD0 с тегом Orientation (или без него). */
function exifSegment(orientation: number | null, littleEndian = false): number[] {
  const u16 = (v: number) => (littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
  const u32 = (v: number) => {
    const be = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    return littleEndian ? be.reverse() : be
  }
  const entries =
    orientation === null ? [] : [...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0]
  return segment(0xe1, [
    ...ascii('Exif\0\0'),
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(orientation === null ? 0 : 1),
    ...entries,
    ...u32(0),
  ])
}

const SOI = [0xff, 0xd8]
const APP0 = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0])
const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii('<x:xmpmeta/>')])
const ICC = segment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9, 9])
const IPTC = segment(0xed, [...ascii('Photoshop 3.0\0'), 1, 2, 3])
const DQT = segment(0xdb, [0, ...Array.from({ length: 16 }, (_, i) => i + 1)])
// SOS + энтропийные данные (с экранированным 0xFF00) + EOI.
const SCAN = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9]

const jpeg = (...parts: number[][]) => new Uint8Array(parts.flat())

describe('pickProfile', () => {
  it('обычный кадр — профиль фото, 2:1 — панорама', () => {
    expect(pickProfile(4000, 3000)).toBe(PHOTO_PROFILE)
    expect(pickProfile(1080, 1920)).toBe(PHOTO_PROFILE)
    expect(pickProfile(5760, 2880)).toBe(PANO_PROFILE)
  })
})

describe('canKeepOriginal', () => {
  const jpg = (size: number) => ({ type: 'image/jpeg', size })

  it('JPEG в пределах лимитов оставляем', () => {
    expect(canKeepOriginal(jpg(200_000), { width: 1280, height: 960 }, PHOTO_PROFILE)).toBe(true)
    expect(canKeepOriginal(jpg(3 * MB), { width: 3072, height: 2304 }, PHOTO_PROFILE)).toBe(true)
  })

  it('панораму всегда пересжимаем', () => {
    expect(canKeepOriginal(jpg(MB), { width: 4096, height: 2048 }, PANO_PROFILE)).toBe(false)
  })

  it('не JPEG пересжимаем', () => {
    const png = { type: 'image/png', size: 200_000 }
    expect(canKeepOriginal(png, { width: 1280, height: 960 }, PHOTO_PROFILE)).toBe(false)
  })

  it('превышение по пикселям или по байтам — пересжимаем', () => {
    expect(canKeepOriginal(jpg(MB), { width: 3073, height: 2304 }, PHOTO_PROFILE)).toBe(false)
    expect(canKeepOriginal(jpg(MB), { width: 2304, height: 3073 }, PHOTO_PROFILE)).toBe(false)
    expect(canKeepOriginal(jpg(3 * MB + 1), { width: 3072, height: 2304 }, PHOTO_PROFILE)).toBe(false)
  })

  it('неизвестные размеры — пересжимаем', () => {
    expect(canKeepOriginal(jpg(200_000), { width: 0, height: 0 }, PHOTO_PROFILE)).toBe(false)
  })
})

describe('thumbSize', () => {
  it('короткая сторона — 360 px', () => {
    expect(thumbSize(4000, 3000)).toEqual({ width: 480, height: 360 })
    expect(thumbSize(1080, 1920)).toEqual({ width: 360, height: 640 })
    expect(thumbSize(4096, 2048)).toEqual({ width: 720, height: 360 })
  })

  it('длинная сторона не больше 1080 px', () => {
    expect(thumbSize(4000, 1000)).toEqual({ width: 1080, height: 270 })
  })

  it('маленький кадр не увеличивается', () => {
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 })
  })
})

describe('downscaleSteps', () => {
  it('делит пополам, затем последний шаг до цели', () => {
    expect(downscaleSteps(3072, 2304, { width: 480, height: 360 })).toEqual([
      { width: 1536, height: 1152 },
      { width: 768, height: 576 },
      { width: 480, height: 360 },
    ])
    expect(downscaleSteps(2304, 3072, { width: 360, height: 480 })).toEqual([
      { width: 1152, height: 1536 },
      { width: 576, height: 768 },
      { width: 360, height: 480 },
    ])
  })

  it('не уменьшает ниже цели на промежуточных шагах', () => {
    expect(downscaleSteps(1000, 750, { width: 480, height: 360 })).toEqual([
      { width: 500, height: 375 },
      { width: 480, height: 360 },
    ])
  })

  it('кадр размером с цель — один шаг', () => {
    expect(downscaleSteps(300, 200, { width: 300, height: 200 })).toEqual([
      { width: 300, height: 200 },
    ])
  })
})

describe('stripJpegMetadata', () => {
  it('вырезает EXIF, XMP и IPTC, остальное оставляет побайтно', () => {
    const src = jpeg(SOI, APP0, exifSegment(1), XMP, ICC, IPTC, DQT, SCAN)
    const out = stripJpegMetadata(src)
    expect(out).not.toBeNull()
    expect(Array.from(out!.bytes)).toEqual([...SOI, ...APP0, ...ICC, ...DQT, ...SCAN])
    expect(out!.orientation).toBe(1)
  })

  it('файл без метаданных не меняется', () => {
    const src = jpeg(SOI, APP0, DQT, SCAN)
    expect(Array.from(stripJpegMetadata(src)!.bytes)).toEqual(Array.from(src))
  })

  it('читает Orientation в обоих порядках байт', () => {
    expect(stripJpegMetadata(jpeg(SOI, exifSegment(6), DQT, SCAN))!.orientation).toBe(6)
    expect(stripJpegMetadata(jpeg(SOI, exifSegment(8, true), DQT, SCAN))!.orientation).toBe(8)
  })

  it('находит Orientation, даже если XMP идёт раньше EXIF', () => {
    expect(stripJpegMetadata(jpeg(SOI, XMP, exifSegment(6), DQT, SCAN))!.orientation).toBe(6)
  })

  it('нет тега или нет EXIF — кадр считается неповёрнутым', () => {
    expect(stripJpegMetadata(jpeg(SOI, exifSegment(null), DQT, SCAN))!.orientation).toBe(1)
    expect(stripJpegMetadata(jpeg(SOI, APP0, DQT, SCAN))!.orientation).toBe(1)
  })

  it('пропускает байты-заполнители перед маркером', () => {
    const src = jpeg(SOI, [0xff], APP0, DQT, SCAN)
    expect(Array.from(stripJpegMetadata(src)!.bytes)).toEqual([...SOI, ...APP0, ...DQT, ...SCAN])
  })

  it('возвращает null на некорректной структуре', () => {
    // Не JPEG.
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    // Длина сегмента выходит за конец файла.
    expect(stripJpegMetadata(jpeg(SOI, [0xff, 0xe0, 0x10, 0x00, 1, 2]))).toBeNull()
    // EOI раньше SOS.
    expect(stripJpegMetadata(jpeg(SOI, APP0, [0xff, 0xd9]))).toBeNull()
    // Нет SOS.
    expect(stripJpegMetadata(jpeg(SOI, APP0, DQT))).toBeNull()
    // Мусор вместо маркера.
    expect(stripJpegMetadata(jpeg(SOI, [0x00, 0x00], SCAN))).toBeNull()
  })

  it('битый EXIF — null, чтобы файл пересжался', () => {
    const broken = segment(0xe1, [...ascii('Exif\0\0'), 0x00, 0x00, 0, 42, 0, 0, 0, 8])
    expect(stripJpegMetadata(jpeg(SOI, broken, DQT, SCAN))).toBeNull()
  })
})
