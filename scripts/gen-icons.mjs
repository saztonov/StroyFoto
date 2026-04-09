// Генератор placeholder-иконок для PWA.
// Создаёт простые PNG (сплошной фон + белый квадрат-накладка) без внешних зависимостей.
// Запускается вручную один раз:  node scripts/gen-icons.mjs
//
// Алгоритм: пишем PNG «руками» — signature + IHDR + IDAT (zlib-compressed raw) + IEND.
// Формат: 8-bit RGB (color type 2).

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons')
mkdirSync(OUT_DIR, { recursive: true })

// Таблица CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePng(size, { bg, fg, fgInsetRatio = 0 }) {
  const [br, bgG, bgB] = bg
  const [fr, fgG, fgB] = fg
  // Строим сырые пиксели построчно (по 1 байту «filter = 0» в начале каждой строки).
  const rowLen = size * 3
  const raw = Buffer.alloc((rowLen + 1) * size)

  const inset = Math.floor(size * fgInsetRatio)
  const fgStart = inset
  const fgEnd = size - inset

  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const idx = y * (rowLen + 1) + 1 + x * 3
      const inside = fgInsetRatio > 0 && x >= fgStart && x < fgEnd && y >= fgStart && y < fgEnd
      if (inside) {
        raw[idx] = fr
        raw[idx + 1] = fgG
        raw[idx + 2] = fgB
      } else {
        raw[idx] = br
        raw[idx + 1] = bgG
        raw[idx + 2] = bgB
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0) // width
  ihdr.writeUInt32BE(size, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const idatData = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const brand = [0x16, 0x77, 0xff] // #1677ff
const white = [0xff, 0xff, 0xff]

const icons = [
  { name: 'icon-192.png', size: 192, inset: 0.28 },
  { name: 'icon-512.png', size: 512, inset: 0.28 },
  // Для maskable нужен «safe area» ~10% от края: делаем больший отступ.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.32 },
]

for (const { name, size, inset } of icons) {
  const buf = makePng(size, { bg: brand, fg: white, fgInsetRatio: inset })
  writeFileSync(resolve(OUT_DIR, name), buf)
  console.log('wrote', name, buf.length, 'bytes')
}
