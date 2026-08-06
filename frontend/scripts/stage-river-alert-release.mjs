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
  path.join(projectRoot, 'dist', 'river-alerts'),
))
const sources = [
  ['map/data/qtct/riverLevel', path.join(projectRoot, 'map/data/qtct/riverLevel')],
  ['map/data/search/riverLevel', path.join(projectRoot, 'map/data/search/riverLevel')],
]
const singleFiles = [
  ['map/data/source-health/riverLevel.json', path.join(projectRoot, 'map/data/source-health/riverLevel.json')],
  ['map/data/alerts/riverLevel.json', path.join(projectRoot, 'map/data/alerts/riverLevel.json')],
  ['map/layers/managed/river-level/publication.json', path.join(projectRoot, 'map/layers/managed/river-level/publication.json')],
]

for (const [, source] of [...sources, ...singleFiles]) {
  if (!fs.existsSync(source)) throw new Error(`river alert release source not found: ${source}`)
  const relative = path.relative(source, outputRoot)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('--output must not be a river alert source or one of its descendants')
  }
}

const temporaryRoot = `${outputRoot}.tmp-${process.pid}`
fs.rmSync(temporaryRoot, { recursive: true, force: true })
fs.mkdirSync(temporaryRoot, { recursive: true })
const files = []
const copyFile = (relativePath, sourcePath) => {
  const normalized = relativePath.replaceAll(path.sep, '/')
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
for (const [releaseBase, sourceRoot] of sources) {
  for (const entry of fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const sourcePath = path.join(entry.parentPath, entry.name)
    copyFile(path.join(releaseBase, path.relative(sourceRoot, sourcePath)), sourcePath)
  }
}
for (const [relativePath, sourcePath] of singleFiles) copyFile(relativePath, sourcePath)
files.sort((a, b) => a.path.localeCompare(b.path))

const health = JSON.parse(fs.readFileSync(singleFiles[0][1], 'utf8'))
const publication = JSON.parse(fs.readFileSync(singleFiles[2][1], 'utf8'))
const release = {
  schemaVersion: 1,
  kind: 'svg3-river-alert-release',
  layerId: 'riverLevel',
  generatedAt: new Date().toISOString(),
  published: publication.published,
  snapshotUpdatedAt: health.snapshotUpdatedAt,
  recordCount: health.recordCount,
  files,
  totals: {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  },
  publish: {
    root: 'map',
    cacheControl: 'public, max-age=120, stale-while-revalidate=600',
    cors: 'Access-Control-Allow-Origin: *',
    order: 'Upload data files first and release.json last.',
  },
}
fs.writeFileSync(path.join(temporaryRoot, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.renameSync(temporaryRoot, outputRoot)
console.log(
  `[river-alerts:stage] ${release.recordCount} stations, ${release.totals.files} files, `
  + `${release.totals.bytes} bytes -> ${outputRoot}`,
)
