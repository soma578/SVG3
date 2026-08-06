#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')

const argValue = (name, fallback = '') =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback

const sourcePath = path.resolve(argValue(
  'source',
  path.join(projectRoot, 'map', 'sources', 'japan-river-webcams', 'cameras.json'),
))
const outRoot = path.resolve(argValue('out-root', path.join(projectRoot, 'map', 'media-cache', 'webcams')))
const delayMs = Number(argValue('delay-ms', '1500'))
const ttlMinutes = Number(argValue('ttl-minutes', '10'))
const limit = Number(argValue('limit', '0'))
const regionId = argValue('region', '')
const allowAll = argValue('allow-all', 'false') === 'true'
const now = Date.now()

if (!regionId && !allowAll) {
  throw new Error('refusing nationwide cache fetch: pass --region=<regionId> (or explicit --allow-all=true)')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const safeId = (value) => String(value || '')
  .replace(/^.*?:\/\//, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'camera'

const isFresh = (filePath) => {
  if (!fs.existsSync(filePath)) return false
  const ageMinutes = (now - fs.statSync(filePath).mtimeMs) / 60_000
  return ageMinutes >= 0 && ageMinutes < ttlMinutes
}

const writeCacheFile = (relativePath, buffer) => {
  const filePath = path.join(outRoot, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

const fetchBinary = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'SVG3 disaster map cache job (single scheduled fetch; contact site operator)',
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  const contentType = response.headers.get('content-type') || ''
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`non-image response: ${contentType}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

if (!fs.existsSync(sourcePath)) throw new Error(`camera source not found: ${sourcePath}`)
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const cameras = Array.isArray(source.cameras) ? source.cameras : []
let regionName = ''
let regionCameraIds = null
if (regionId) {
  const regionsPath = path.join(projectRoot, 'map', 'regions', 'index.json')
  const regions = JSON.parse(fs.readFileSync(regionsPath, 'utf8')).regions || []
  const region = regions.find((entry) => entry.id === regionId)
  if (!region?.prefecture) throw new Error(`unknown --region=${regionId}`)
  regionName = region.prefecture
  const detailPath = path.join(projectRoot, 'map', 'data', 'qtct', 'japanRiverWebcam', regionId, 'detail.json')
  if (fs.existsSync(detailPath)) {
    const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'))
    regionCameraIds = new Set()
    const pending = detail.tree ? [detail.tree] : []
    while (pending.length > 0) {
      const node = pending.pop()
      for (const record of node?.records || []) regionCameraIds.add(String(record.id || ''))
      pending.push(...(node?.children || []))
    }
  }
}
const eligibleTargets = cameras.filter((camera) => {
  if (!camera.imageUrl || !/^https?:\/\//i.test(camera.imageUrl)) return false
  if (regionCameraIds) return regionCameraIds.has(String(camera.id || ''))
  if (!regionName) return true
  return [camera.location, camera.title, camera.provider]
    .some((value) => String(value || '').includes(regionName))
})
const targets = limit > 0 ? eligibleTargets.slice(0, limit) : eligibleTargets

const manifest = {
  updatedAt: new Date(now).toISOString(),
  source: sourcePath,
  policy: {
    clientExternalFetch: false,
    delayMs,
    ttlMinutes,
    regionId: regionId || null,
  },
  summary: {
    total: targets.length,
    fetched: 0,
    skipped: 0,
    failed: 0,
    failureRate: 0,
    nextRecommendedAt: new Date(now + ttlMinutes * 60_000).toISOString(),
  },
  images: [],
}

let fetched = 0
let skipped = 0
let failed = 0

for (const camera of targets) {
  const cameraId = safeId(camera.cameraId || camera.id)
  const relativePath = path.join('current', `${cameraId}.jpg`)
  const cachedPath = path.join(outRoot, relativePath)
  const publicUrl = `/map/media-cache/webcams/${relativePath.replaceAll(path.sep, '/')}`
  if (isFresh(cachedPath)) {
    skipped += 1
    manifest.images.push({ cameraId: String(camera.cameraId || ''), id: camera.id, imageUrl: publicUrl, sourceImageUrl: camera.imageUrl, status: 'fresh' })
    continue
  }
  try {
    const buffer = await fetchBinary(camera.imageUrl)
    writeCacheFile(relativePath, buffer)
    fetched += 1
    manifest.images.push({ cameraId: String(camera.cameraId || ''), id: camera.id, imageUrl: publicUrl, sourceImageUrl: camera.imageUrl, status: 'fetched' })
  } catch (error) {
    failed += 1
    manifest.images.push({ cameraId: String(camera.cameraId || ''), id: camera.id, imageUrl: publicUrl, sourceImageUrl: camera.imageUrl, status: 'failed', error: error.message })
    console.warn(`[webcam-cache] failed ${camera.id || camera.cameraId}: ${error.message}`)
  }
  await sleep(delayMs)
}

manifest.summary.fetched = fetched
manifest.summary.skipped = skipped
manifest.summary.failed = failed
manifest.summary.failureRate = targets.length > 0 ? failed / targets.length : 0

const writeManifest = (root, value) => {
  const filePath = path.join(root, 'manifest.json')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

writeManifest(outRoot, manifest)

console.log(`[webcam-cache] fetched=${fetched} skipped=${skipped} failed=${failed} total=${targets.length}`)
