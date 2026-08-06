#!/usr/bin/env node
/**
 * PWA アイコン生成
 * ================
 * 依存を増やさずに PNG を作る（zlib は Node 標準）。
 * 「防」の字を描くのではなく、視認しやすい単純な図形にしている。
 * インストール可能性よりオフライン起動を優先する方針なので、意匠は最小限。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const outDir = path.join(projectRoot, 'map', 'icons', 'app')

const BRAND = [18, 78, 60] // #124E3C 濃緑
const MARK = [255, 255, 255]

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** 角丸の四角 + 中央の十字（救護・防災の記号として読める最小形）。 */
const pixel = (x, y, size) => {
  const radius = size * 0.22
  const inset = size * 0.06
  const min = inset
  const max = size - inset
  const inside = (() => {
    if (x < min || x > max || y < min || y > max) return false
    const cx = Math.min(Math.max(x, min + radius), max - radius)
    const cy = Math.min(Math.max(y, min + radius), max - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
      || (x >= min + radius && x <= max - radius)
      || (y >= min + radius && y <= max - radius)
  })()
  if (!inside) return null
  const arm = size * 0.10
  const reach = size * 0.30
  const dx = Math.abs(x - size / 2)
  const dy = Math.abs(y - size / 2)
  const onCross = (dx <= arm && dy <= reach) || (dy <= arm && dx <= reach)
  return onCross ? MARK : BRAND
}

const png = (size) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const color = pixel(x + 0.5, y + 0.5, size)
      if (color) {
        raw[offset] = color[0]
        raw[offset + 1] = color[1]
        raw[offset + 2] = color[2]
        raw[offset + 3] = 255
      }
      offset += 4
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(outDir, { recursive: true })
for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`)
  const data = png(size)
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(data)) {
    fs.writeFileSync(file, data)
  }
  console.log(`[pwa-icons] ${path.relative(projectRoot, file)} ${data.length} bytes`)
}
