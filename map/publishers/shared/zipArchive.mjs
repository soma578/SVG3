const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

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

const dosTimestamp = (date) => {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

const joinBytes = (parts) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const normalizedEntries = (files) => [...files.entries()].map(([name, content]) => {
  const normalizedName = String(name).replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalizedName || normalizedName.split('/').includes('..')) throw new Error(`ZIP path is invalid: ${name}`)
  const nameBytes = encoder.encode(normalizedName)
  const data = content instanceof Uint8Array ? content : encoder.encode(String(content))
  return { name: normalizedName, nameBytes, data, crc: crc32(data) }
})

export const createZipArchive = (files, { modifiedAt = new Date() } = {}) => {
  const entries = normalizedEntries(files)
  if (entries.length === 0) throw new Error('ZIPには1つ以上のファイルが必要です')
  const timestamp = dosTimestamp(modifiedAt)
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const entry of entries) {
    const local = new Uint8Array(30)
    const localView = new DataView(local.buffer)
    setUint32(localView, 0, 0x04034b50)
    setUint16(localView, 4, 20)
    setUint16(localView, 6, 0x0800)
    setUint16(localView, 8, 0)
    setUint16(localView, 10, timestamp.time)
    setUint16(localView, 12, timestamp.date)
    setUint32(localView, 14, entry.crc)
    setUint32(localView, 18, entry.data.byteLength)
    setUint32(localView, 22, entry.data.byteLength)
    setUint16(localView, 26, entry.nameBytes.byteLength)
    localParts.push(local, entry.nameBytes, entry.data)

    const central = new Uint8Array(46)
    const centralView = new DataView(central.buffer)
    setUint32(centralView, 0, 0x02014b50)
    setUint16(centralView, 4, 20)
    setUint16(centralView, 6, 20)
    setUint16(centralView, 8, 0x0800)
    setUint16(centralView, 10, 0)
    setUint16(centralView, 12, timestamp.time)
    setUint16(centralView, 14, timestamp.date)
    setUint32(centralView, 16, entry.crc)
    setUint32(centralView, 20, entry.data.byteLength)
    setUint32(centralView, 24, entry.data.byteLength)
    setUint16(centralView, 28, entry.nameBytes.byteLength)
    setUint32(centralView, 42, localOffset)
    centralParts.push(central, entry.nameBytes)
    localOffset += local.byteLength + entry.nameBytes.byteLength + entry.data.byteLength
  }

  const centralDirectory = joinBytes(centralParts)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  setUint32(endView, 0, 0x06054b50)
  setUint16(endView, 8, entries.length)
  setUint16(endView, 10, entries.length)
  setUint32(endView, 12, centralDirectory.byteLength)
  setUint32(endView, 16, localOffset)
  return joinBytes([...localParts, centralDirectory, end])
}

const findEndRecord = (bytes) => {
  const minimum = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === 0x06054b50) return offset
  }
  return -1
}

const safeZipPath = (name) => {
  const normalized = String(name).replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`ZIP path is invalid: ${name}`)
  }
  return normalized
}

export const readZipArchive = (input, { maxEntries = 200, maxBytes = 25_000_000 } = {}) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > maxBytes) throw new Error(`ZIP is too large: ${bytes.byteLength} bytes`)
  const endOffset = findEndRecord(bytes)
  if (endOffset < 0) throw new Error('ZIP end record is missing')
  const end = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22)
  const disk = end.getUint16(4, true)
  const centralDisk = end.getUint16(6, true)
  const entries = end.getUint16(10, true)
  const centralSize = end.getUint32(12, true)
  const centralOffset = end.getUint32(16, true)
  if (disk !== 0 || centralDisk !== 0) throw new Error('Multi-disk ZIP is unsupported')
  if (entries < 1 || entries > maxEntries) throw new Error(`ZIP entry count is invalid: ${entries}`)
  if (centralOffset + centralSize > endOffset) throw new Error('ZIP central directory is invalid')

  const files = new Map()
  let offset = centralOffset
  let totalBytes = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength) throw new Error('ZIP central entry is truncated')
    const central = new DataView(bytes.buffer, bytes.byteOffset + offset, 46)
    if (central.getUint32(0, true) !== 0x02014b50) throw new Error('ZIP central entry signature is invalid')
    const flags = central.getUint16(8, true)
    const method = central.getUint16(10, true)
    const expectedCrc = central.getUint32(16, true)
    const compressedSize = central.getUint32(20, true)
    const uncompressedSize = central.getUint32(24, true)
    const nameLength = central.getUint16(28, true)
    const extraLength = central.getUint16(30, true)
    const commentLength = central.getUint16(32, true)
    const localOffset = central.getUint32(42, true)
    if ((flags & ~0x0800) !== 0) throw new Error('ZIP entry flags are unsupported')
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error('Only stored ZIP entries are supported')
    const nameStart = offset + 46
    const name = safeZipPath(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)))
    if (files.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`)

    if (localOffset + 30 > bytes.byteLength) throw new Error(`ZIP local entry is truncated: ${name}`)
    const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset, 30)
    if (local.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP local signature is invalid: ${name}`)
    if (local.getUint16(8, true) !== method) throw new Error(`ZIP method mismatch: ${name}`)
    const localNameLength = local.getUint16(26, true)
    const localExtraLength = local.getUint16(28, true)
    const localNameStart = localOffset + 30
    const localName = safeZipPath(decoder.decode(bytes.subarray(localNameStart, localNameStart + localNameLength)))
    if (localName !== name) throw new Error(`ZIP local name mismatch: ${name}`)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (dataOffset + compressedSize > bytes.byteLength) throw new Error(`ZIP data is truncated: ${name}`)
    const data = bytes.slice(dataOffset, dataOffset + compressedSize)
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP CRC mismatch: ${name}`)
    totalBytes += data.byteLength
    if (totalBytes > maxBytes) throw new Error(`ZIP expanded data is too large: ${totalBytes} bytes`)
    files.set(name, data)
    offset = nameStart + nameLength + extraLength + commentLength
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP central directory size mismatch')
  return files
}
