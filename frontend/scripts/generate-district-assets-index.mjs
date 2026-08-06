#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(process.cwd(), '..')
const districtRoot = path.join(projectRoot, 'map', 'data', 'districts')
const regionIndex = JSON.parse(fs.readFileSync(path.join(projectRoot, 'map', 'regions', 'index.json'), 'utf8'))

const attr = (source, name) => {
  const match = String(source).match(new RegExp(`\\b${name}="([^"]*)"`))
  return match?.[1] || ''
}

const decodeXml = (value) => String(value || '')
  .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

const ringsFromPath = (d) => String(d || '').split(/(?=[Mm]\s*-?\d)/)
  .map((part) => [...part.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]))
  .filter((ring) => ring.length >= 3)

const ringArea = (ring) => Math.abs(ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]
  return sum + point[0] * next[1] - next[0] * point[1]
}, 0) / 2)

const pointInRing = (x, y, ring) => {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[previous]
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside
  }
  return inside
}

const representativePoint = (rings) => {
  const ring = [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0]
  if (!ring) return null
  let twiceArea = 0
  let cx = 0
  let cy = 0
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length]
    const cross = x1 * y2 - x2 * y1
    twiceArea += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  })
  if (Math.abs(twiceArea) > 1e-12) {
    const centroid = [cx / (3 * twiceArea), cy / (3 * twiceArea)]
    if (pointInRing(centroid[0], centroid[1], ring)) return centroid
  }
  const ys = ring.map((point) => point[1])
  let best = null
  for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * fraction
    const crossings = []
    for (let index = 0; index < ring.length; index += 1) {
      const [x1, y1] = ring[index]
      const [x2, y2] = ring[(index + 1) % ring.length]
      if ((y1 > y) === (y2 > y)) continue
      crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
    }
    crossings.sort((a, b) => a - b)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const width = crossings[index + 1] - crossings[index]
      if (!best || width > best.width) best = { width, point: [(crossings[index] + crossings[index + 1]) / 2, y] }
    }
  }
  return best?.point || ring[0]
}

const municipalityLabels = (regionId) => {
  const filePath = path.join(projectRoot, 'map', 'regions', regionId, 'municipalities.json')
  if (!fs.existsSync(filePath)) return new Map()
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const labels = new Map()
  for (const municipality of document.municipalities || []) {
    for (const code of municipality.municipalityCodes || [municipality.displayCode, municipality.id]) {
      if (code) labels.set(String(code), municipality.label)
    }
  }
  return labels
}

const writeIfChanged = (filePath, content) => {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

const regions = []
for (const region of regionIndex.regions || []) {
  const regionRoot = path.join(districtRoot, region.id)
  const svgRoot = path.join(regionRoot, 'districts-svg')
  if (!fs.existsSync(svgRoot)) continue
  const files = fs.readdirSync(svgRoot)
    .filter((name) => /^\d{5}\.svg$/.test(name))
    .sort()
    .map((name) => {
      const filePath = path.join(svgRoot, name)
      const stat = fs.statSync(filePath)
      return { code: name.slice(0, -4), path: `districts-svg/${name}`, bytes: stat.size, filePath }
    })
  const labels = municipalityLabels(region.id)
  const districtByKey = new Map()
  for (const file of files) {
    const svg = fs.readFileSync(file.filePath, 'utf8')
    for (const match of svg.matchAll(/<path\b([^>]*)>/g)) {
      const attributes = match[1]
      const key = attr(attributes, 'data-key-code')
      const name = decodeXml(attr(attributes, 'data-name'))
      const municipalityCode = attr(attributes, 'data-municipality-code') || file.code
      const rings = ringsFromPath(attr(attributes, 'd'))
      const point = representativePoint(rings)
      if (!key || !name || !point) continue
      const candidate = {
        key, name, municipalityCode,
        municipalityName: labels.get(municipalityCode) || '',
        lon: Number(point[0].toFixed(6)),
        lat: Number(point[1].toFixed(6)),
        area: rings.reduce((sum, ring) => sum + ringArea(ring), 0),
      }
      const existing = districtByKey.get(key)
      if (!existing || candidate.area > existing.area) districtByKey.set(key, candidate)
    }
    delete file.filePath
  }
  const districts = [...districtByKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ area, ...district }) => district)
  writeIfChanged(path.join(regionRoot, 'district-index.json'), `${JSON.stringify({
    schemaVersion: 1, regionId: region.id, regionLabel: region.label, districts,
  })}\n`)
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const manifest = {
    schemaVersion: 1,
    regionId: region.id,
    publicBase: `/data/${region.id}`,
    fileCount: files.length,
    bytes,
    files,
  }
  writeIfChanged(path.join(regionRoot, 'assets.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  regions.push({
    id: region.id,
    label: region.label,
    manifest: `/map/data/districts/${region.id}/assets.json`,
    fileCount: files.length,
    bytes,
  })
}

const index = {
  schemaVersion: 1,
  publicUrlTemplate: '/data/{regionId}/districts-svg/{code}.svg',
  regions,
  totals: {
    regions: regions.length,
    files: regions.reduce((sum, region) => sum + region.fileCount, 0),
    bytes: regions.reduce((sum, region) => sum + region.bytes, 0),
  },
}
writeIfChanged(path.join(districtRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`[districts:index] ${index.totals.regions} regions, ${index.totals.files} files, ${index.totals.bytes} bytes`)
