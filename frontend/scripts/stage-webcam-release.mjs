#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback = '') => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || '' : fallback
}

const outputRoot = path.resolve(option(
  '--output',
  path.join(projectRoot, 'dist', 'japan-river-webcams'),
))
const sourceRoots = [
  ['map/data/qtct/japanRiverWebcam', path.join(projectRoot, 'map', 'data', 'qtct', 'japanRiverWebcam')],
  ['map/data/search/japanRiverWebcam', path.join(projectRoot, 'map', 'data', 'search', 'japanRiverWebcam')],
]
const healthSource = path.join(projectRoot, 'map', 'data', 'source-health', 'japanRiverWebcam.json')

for (const [, sourceRoot] of sourceRoots) {
  if (!fs.existsSync(sourceRoot)) throw new Error(`webcam release source not found: ${sourceRoot}`)
  const relative = path.relative(sourceRoot, outputRoot)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('--output must not be a webcam release source or one of its descendants')
  }
}
if (!fs.existsSync(healthSource)) throw new Error(`webcam health file not found: ${healthSource}`)

const temporaryRoot = `${outputRoot}.tmp-${process.pid}`
fs.rmSync(temporaryRoot, { recursive: true, force: true })
fs.mkdirSync(temporaryRoot, { recursive: true })

const files = []
const copyFile = (relativePath, sourcePath) => {
  const normalized = relativePath.replaceAll(path.sep, '/')
  if (normalized.includes('..') || normalized.startsWith('/')) {
    throw new Error(`invalid webcam release path: ${relativePath}`)
  }
  const targetPath = path.join(temporaryRoot, normalized)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  const body = fs.readFileSync(sourcePath)
  files.push({
    path: normalized,
    bytes: body.byteLength,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
  })
}

for (const [releaseBase, sourceRoot] of sourceRoots) {
  for (const entry of fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const sourcePath = path.join(entry.parentPath, entry.name)
    const relativePath = path.relative(sourceRoot, sourcePath)
    copyFile(path.join(releaseBase, relativePath), sourcePath)
  }
}
copyFile('map/data/source-health/japanRiverWebcam.json', healthSource)
files.sort((a, b) => a.path.localeCompare(b.path))

const health = JSON.parse(fs.readFileSync(healthSource, 'utf8'))
const release = {
  schemaVersion: 1,
  kind: 'svg3-webcam-data-release',
  layerId: 'japanRiverWebcam',
  generatedAt: new Date().toISOString(),
  snapshotUpdatedAt: health.snapshotUpdatedAt,
  recordCount: health.recordCount,
  files,
  totals: {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  },
  publish: {
    root: 'map/data',
    cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    cors: 'Access-Control-Allow-Origin: *',
    order: 'Upload data files first and release.json last.',
  },
}
fs.writeFileSync(
  path.join(temporaryRoot, 'release.json'),
  `${JSON.stringify(release, null, 2)}\n`,
)
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.renameSync(temporaryRoot, outputRoot)

console.log(
  `[webcams:stage] ${release.recordCount} cameras, ${release.totals.files} files, `
  + `${release.totals.bytes} bytes -> ${outputRoot}`,
)
