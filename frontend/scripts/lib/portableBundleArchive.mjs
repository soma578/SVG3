import fs from 'node:fs'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const setUint16 = (view, offset, value) => view.setUint16(offset, value, true)
const setUint32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true)

const dosTimestamp = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ZIP timestamp: ${value}`)
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()))
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

const joinBuffers = (parts) => Buffer.concat(parts.map((part) => Buffer.from(part)))

const safeName = (value) => {
  const name = String(value).replaceAll('\\', '/').replace(/^\/+/, '')
  if (!name || name.endsWith('/') || name.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`invalid ZIP path: ${value}`)
  }
  return name
}

export const createPortableBundleArchive = (bundleRoot, { rootName, modifiedAt, include = () => true }) => {
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else {
        const relative = path.relative(bundleRoot, target).split(path.sep).join('/')
        if (!entry.name.endsWith('.zip') && include(relative)) files.push(target)
      }
    }
  }
  walk(bundleRoot)
  const timestamp = dosTimestamp(modifiedAt)
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const filePath of files) {
    const name = safeName(`${rootName}/${path.relative(bundleRoot, filePath).split(path.sep).join('/')}`)
    const nameBytes = Buffer.from(name, 'utf8')
    const source = fs.readFileSync(filePath)
    const compressed = deflateRawSync(source, { level: 9 })
    const crc = crc32(source)

    const local = Buffer.alloc(30)
    const localView = new DataView(local.buffer, local.byteOffset, local.byteLength)
    setUint32(localView, 0, 0x04034b50)
    setUint16(localView, 4, 20)
    setUint16(localView, 6, 0x0800)
    setUint16(localView, 8, 8)
    setUint16(localView, 10, timestamp.time)
    setUint16(localView, 12, timestamp.date)
    setUint32(localView, 14, crc)
    setUint32(localView, 18, compressed.byteLength)
    setUint32(localView, 22, source.byteLength)
    setUint16(localView, 26, nameBytes.byteLength)
    localParts.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength)
    setUint32(centralView, 0, 0x02014b50)
    setUint16(centralView, 4, 20)
    setUint16(centralView, 6, 20)
    setUint16(centralView, 8, 0x0800)
    setUint16(centralView, 10, 8)
    setUint16(centralView, 12, timestamp.time)
    setUint16(centralView, 14, timestamp.date)
    setUint32(centralView, 16, crc)
    setUint32(centralView, 20, compressed.byteLength)
    setUint32(centralView, 24, source.byteLength)
    setUint16(centralView, 28, nameBytes.byteLength)
    setUint32(centralView, 42, localOffset)
    centralParts.push(central, nameBytes)
    localOffset += local.byteLength + nameBytes.byteLength + compressed.byteLength
  }

  if (files.length === 0 || files.length > 0xffff) throw new Error(`invalid ZIP file count: ${files.length}`)
  const centralDirectory = joinBuffers(centralParts)
  const end = Buffer.alloc(22)
  const endView = new DataView(end.buffer, end.byteOffset, end.byteLength)
  setUint32(endView, 0, 0x06054b50)
  setUint16(endView, 8, files.length)
  setUint16(endView, 10, files.length)
  setUint32(endView, 12, centralDirectory.byteLength)
  setUint32(endView, 16, localOffset)
  return joinBuffers([...localParts, centralDirectory, end])
}

const findEndRecord = (bytes) => {
  const minimum = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

export const readPortableBundleArchive = (input, { maxEntries = 500, maxBytes = 100_000_000 } = {}) => {
  const bytes = Buffer.from(input)
  const endOffset = findEndRecord(bytes)
  if (endOffset < 0) throw new Error('ZIP end record is missing')
  const entries = bytes.readUInt16LE(endOffset + 10)
  const centralSize = bytes.readUInt32LE(endOffset + 12)
  const centralOffset = bytes.readUInt32LE(endOffset + 16)
  if (entries < 1 || entries > maxEntries || centralOffset + centralSize > endOffset) {
    throw new Error('ZIP central directory is invalid')
  }

  const files = new Map()
  let offset = centralOffset
  let expandedBytes = 0
  for (let index = 0; index < entries; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP central entry is invalid')
    const method = bytes.readUInt16LE(offset + 10)
    const expectedCrc = bytes.readUInt32LE(offset + 16)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const sourceSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = safeName(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    if (files.has(name) || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`invalid ZIP entry: ${name}`)
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize)
    const source = method === 8 ? inflateRawSync(compressed) : method === 0 ? compressed : null
    if (!source || source.byteLength !== sourceSize || crc32(source) !== expectedCrc) {
      throw new Error(`invalid ZIP content: ${name}`)
    }
    expandedBytes += source.byteLength
    if (expandedBytes > maxBytes) throw new Error(`ZIP expanded data is too large: ${expandedBytes}`)
    files.set(name, source)
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP central directory size mismatch')
  return files
}
