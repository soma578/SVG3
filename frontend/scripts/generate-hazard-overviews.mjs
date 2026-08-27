#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const sourceRoot = path.join(mapRoot, 'layers', 'hazard')
const regionOutlineRoot = path.join(mapRoot, 'layers', 'overview', 'pref')
const outputRoot = path.join(mapRoot, 'layers', 'hazard-overview')
const indexPath = path.join(outputRoot, 'index.json')

const NATIONAL_VIEW_BOX = Object.freeze({ x: 12243.4, y: -4605.6, width: 3205.3, height: 2251.0 })
const NATIONAL_WIDTH = 2048
const REGION_LONG_SIDE = 1536
const REGION_PADDING_RATIO = 0.03
const RENDER_CONCURRENCY = 2
const resumeExisting = process.argv.includes('--resume-existing')

const TYPES = Object.freeze({
  flood: 'hazard-flood',
  tsunami: 'hazard-tsunami-inundation',
  'landslide-warning': 'hazard-landslide-warning',
  'landslide-special': 'hazard-landslide-special',
})

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

const writeIfChanged = (target, content) => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) return false
  fs.writeFileSync(target, content)
  return true
}

const prefSourceFile = (prefCode) => {
  const dir = path.join(sourceRoot, String(prefCode))
  if (!fs.existsSync(dir)) return null
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.svg'))
    .sort()
    .map((name) => path.join(dir, name))
    .find((file) => fs.statSync(file).isFile()) || null
}

const parseRegionBounds = (prefCode) => {
  const source = fs.readFileSync(path.join(regionOutlineRoot, `${prefCode}.svg`), 'utf8')
  const match = source.match(/viewBox="global,([^,]+),([^,]+),([^,]+),([^"\s]+)"/)
  if (!match) throw new Error(`missing global viewBox: map/layers/overview/pref/${prefCode}.svg`)
  const [, lon, lat, lonSpan, latSpan] = match.map(Number)
  const padding = Math.max(lonSpan, latSpan) * REGION_PADDING_RATIO
  return {
    x: (lon - padding) * 100,
    y: -(lat + latSpan + padding) * 100,
    width: (lonSpan + padding * 2) * 100,
    height: (latSpan + padding * 2) * 100,
  }
}

const extractGroup = (source, groupId, { keepId = true } = {}) => {
  const escaped = groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`<g\\s+id="${escaped}"[^>]*>[\\s\\S]*?<\\/g>`))
  if (!match) throw new Error(`missing hazard group: ${groupId}`)
  return keepId ? match[0] : match[0].replace(` id="${groupId}"`, '')
}

const renderWebp = async ({ groups, viewBox, width }) => {
  const height = Math.max(1, Math.round(width * viewBox.height / viewBox.width))
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" width="${width}" height="${height}">${groups.join('')}</svg>`,
  )
  return sharp(svg, { limitInputPixels: false })
    .webp({ lossless: true, effort: 4 })
    .toBuffer()
}

const renderOrResumeWebp = async ({ target, groups, viewBox, width }) => {
  const expectedHeight = Math.max(1, Math.round(width * viewBox.height / viewBox.width))
  if (resumeExisting && fs.existsSync(target)) {
    const metadata = await sharp(target).metadata()
    if (metadata.format === 'webp' && metadata.width === width && metadata.height === expectedHeight) {
      return fs.readFileSync(target)
    }
  }
  const buffer = await renderWebp({ groups, viewBox, width })
  writeIfChanged(target, buffer)
  return buffer
}

const runLimited = async (tasks, concurrency) => {
  let cursor = 0
  let completed = 0
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      await tasks[index]()
      completed += 1
      if (completed % 10 === 0 || completed === tasks.length) {
        console.log(`[hazard-overview] rendered ${completed}/${tasks.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
}

const regionIndex = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8'))
const regionList = (Array.isArray(regionIndex) ? regionIndex : regionIndex.regions)
  .map((region) => ({
    id: region.id,
    prefCode: String(region.prefCode).padStart(2, '0'),
    label: region.label,
  }))

const sources = regionList.map((region) => {
  const file = prefSourceFile(Number(region.prefCode))
  if (!file) throw new Error(`missing prefecture hazard SVG: ${region.prefCode} ${region.id}`)
  return { ...region, file, source: fs.readFileSync(file, 'utf8'), bounds: parseRegionBounds(region.prefCode) }
})

const sourceHash = sha256(JSON.stringify({
  nationalViewBox: NATIONAL_VIEW_BOX,
  nationalWidth: NATIONAL_WIDTH,
  regionLongSide: REGION_LONG_SIDE,
  regionPaddingRatio: REGION_PADDING_RATIO,
  types: TYPES,
  sources: sources.map(({ prefCode, source, bounds }) => ({ prefCode, sha256: sha256(source), bounds })),
}))

if (fs.existsSync(indexPath)) {
  const previous = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  const outputs = [
    ...Object.values(previous.national?.types || {}).map((entry) => entry.url),
    ...Object.values(previous.regions || {}).flatMap((region) => Object.values(region.types || {}).map((entry) => entry.url)),
  ]
  if (
    previous.sourceHash === sourceHash
    && outputs.length === (regionList.length + 1) * Object.keys(TYPES).length
    && outputs.every((url) => fs.existsSync(path.join(projectRoot, url.replace(/^\//, ''))))
  ) {
    console.log(`[hazard-overview] unchanged: ${outputs.length} image(s), source ${sourceHash.slice(0, 12)}`)
    process.exit(0)
  }
}

const index = {
  schemaVersion: 1,
  kind: 'svg3-hazard-image-overviews',
  sourceHash,
  generatedAt: new Date().toISOString(),
  format: 'webp',
  rendering: {
    strategy: 'screen-resolution-image-overview',
    nationalWidth: NATIONAL_WIDTH,
    regionLongSide: REGION_LONG_SIDE,
    regionPaddingRatio: REGION_PADDING_RATIO,
  },
  national: { bounds: NATIONAL_VIEW_BOX, types: {} },
  regions: {},
}

let imageCount = 0
let totalBytes = 0
for (const [type, groupId] of Object.entries(TYPES)) {
  const relative = `national/${type}.webp`
  const buffer = await renderOrResumeWebp({
    target: path.join(outputRoot, relative),
    groups: sources.map(({ source }) => extractGroup(source, groupId, { keepId: false })),
    viewBox: NATIONAL_VIEW_BOX,
    width: NATIONAL_WIDTH,
  })
  index.national.types[type] = {
    url: `/map/layers/hazard-overview/${relative}`,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  }
  imageCount += 1
  totalBytes += buffer.byteLength
}

const regionTasks = []
for (const region of sources) {
  const width = region.bounds.width >= region.bounds.height
    ? REGION_LONG_SIDE
    : Math.max(1, Math.round(REGION_LONG_SIDE * region.bounds.width / region.bounds.height))
  const entry = {
    id: region.id,
    prefCode: region.prefCode,
    label: region.label,
    bounds: region.bounds,
    types: {},
  }
  index.regions[region.prefCode] = entry
  for (const [type, groupId] of Object.entries(TYPES)) {
    regionTasks.push(async () => {
      const relative = `${region.prefCode}/${type}.webp`
      const buffer = await renderOrResumeWebp({
        target: path.join(outputRoot, relative),
        groups: [extractGroup(region.source, groupId)],
        viewBox: region.bounds,
        width,
      })
      entry.types[type] = {
        url: `/map/layers/hazard-overview/${relative}`,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      }
      imageCount += 1
      totalBytes += buffer.byteLength
    })
  }
}
await runLimited(regionTasks, RENDER_CONCURRENCY)

writeIfChanged(indexPath, Buffer.from(`${JSON.stringify(index, null, 2)}\n`))
console.log(`[hazard-overview] ${imageCount} image(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, source ${sourceHash.slice(0, 12)}`)
