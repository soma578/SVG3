import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const RIVER_ALERT_DEPLOY_MANIFEST = 'map/data/releases/riverLevel.json'
export const RIVER_ALERT_TARGET_MARKER = '.svg3-static-root.json'

const exactPaths = new Set([
  'map/data/alerts/riverLevel.json',
  'map/data/qtct/riverLevel/summary.json',
  'map/data/source-health/riverLevel.json',
  'map/layers/managed/river-level/publication.json',
])
const pathPrefixes = [
  'map/data/qtct/riverLevel/',
  'map/data/search/riverLevel/',
]

export const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex')

export const acquireExclusiveLock = (lockPath, payload) => {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  let descriptor
  try {
    descriptor = fs.openSync(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`river alert deploy is already running: ${lockPath}`)
    throw error
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(payload)}\n`)
  } catch (error) {
    fs.closeSync(descriptor)
    fs.rmSync(lockPath, { force: true })
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    fs.closeSync(descriptor)
    fs.rmSync(lockPath, { force: true })
  }
}

export const safeReleasePath = (value) => {
  const normalized = String(value || '').replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.includes('\0')
    || path.posix.normalize(normalized) !== normalized
    || normalized.split('/').includes('..')
  ) {
    return null
  }
  return normalized
}

export const isRiverAlertPath = (relativePath) => (
  exactPaths.has(relativePath)
  || pathPrefixes.some((prefix) => relativePath.startsWith(prefix))
)

export const validateRiverAlertRelease = (releaseRoot) => {
  const root = path.resolve(releaseRoot)
  const manifestPath = path.join(root, 'release.json')
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(`river alert release manifest not found: ${manifestPath}`)
  }
  const manifestBody = fs.readFileSync(manifestPath)
  const release = JSON.parse(manifestBody.toString('utf8'))
  if (
    release.schemaVersion !== 1
    || release.kind !== 'svg3-river-alert-release'
    || release.layerId !== 'riverLevel'
  ) {
    throw new Error('unsupported river alert release manifest')
  }
  if (release.published !== true) throw new Error('river alert release is not published')
  if (!Number.isInteger(release.recordCount) || release.recordCount < 0) {
    throw new Error('river alert release has an invalid record count')
  }
  const snapshotTime = Date.parse(release.snapshotUpdatedAt)
  if (!Number.isFinite(snapshotTime)) {
    throw new Error('river alert release has no valid snapshotUpdatedAt')
  }
  if (!Array.isArray(release.files) || release.files.length === 0 || release.files.length > 500) {
    throw new Error('river alert release has an invalid file list')
  }

  const seen = new Set()
  const files = release.files.map((entry) => {
    const relativePath = safeReleasePath(entry?.path)
    if (!relativePath || !isRiverAlertPath(relativePath) || seen.has(relativePath)) {
      throw new Error(`unsafe or duplicate river alert release path: ${entry?.path || ''}`)
    }
    seen.add(relativePath)
    const sourcePath = path.join(root, relativePath)
    if (!sourcePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(sourcePath)) {
      throw new Error(`river alert release file not found: ${relativePath}`)
    }
    const body = fs.readFileSync(sourcePath)
    if (entry.bytes !== body.byteLength || entry.sha256 !== sha256(body)) {
      throw new Error(`river alert release checksum mismatch: ${relativePath}`)
    }
    return { path: relativePath, sourcePath, bytes: body.byteLength, sha256: entry.sha256 }
  })

  for (const required of exactPaths) {
    if (!seen.has(required)) throw new Error(`river alert release is missing ${required}`)
  }
  if (!files.some((file) => file.path.startsWith('map/data/search/riverLevel/'))) {
    throw new Error('river alert release has no search data')
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  if (release.totals?.files !== files.length || release.totals?.bytes !== totalBytes) {
    throw new Error('river alert release totals do not match its files')
  }
  return {
    root,
    manifestPath,
    manifestBody,
    manifestSha256: sha256(manifestBody),
    release,
    snapshotTime,
    files,
  }
}
