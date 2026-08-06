import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  RIVER_ALERT_DEPLOY_MANIFEST,
  RIVER_ALERT_TARGET_MARKER,
  acquireExclusiveLock,
  isRiverAlertPath,
  safeReleasePath,
  sha256,
} from '../../../shared/riverAlertRelease.mjs'

export const deployRiverAlertRelease = async ({
  releaseInfo,
  options = {},
  environment = process.env,
}) => {
const targetOption = options.target
if (!targetOption) throw new Error('local-static deployer requires --target')
const targetRoot = path.resolve(targetOption)
const dryRun = options.dryRun === true
const initializeTarget = options.initializeTarget === true
const relativeRoots = [
  path.relative(releaseInfo.root, targetRoot),
  path.relative(targetRoot, releaseInfo.root),
]
if (relativeRoots.some((relative) => relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))) {
  throw new Error('river alert release and deploy target must not contain each other')
}

const markerPath = path.join(targetRoot, RIVER_ALERT_TARGET_MARKER)
if (!fs.existsSync(markerPath)) {
  if (!initializeTarget) throw new Error(`deploy target marker not found: ${markerPath}`)
  fs.mkdirSync(targetRoot, { recursive: true })
  const marker = {
    schemaVersion: 1,
    kind: 'svg3-static-root',
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx' })
}
const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
if (marker.schemaVersion !== 1 || marker.kind !== 'svg3-static-root') {
  throw new Error(`invalid deploy target marker: ${markerPath}`)
}

const deployedManifestPath = path.join(targetRoot, RIVER_ALERT_DEPLOY_MANIFEST)
let previousRelease = null
let previousManifestBody = null
if (fs.existsSync(deployedManifestPath)) {
  previousManifestBody = fs.readFileSync(deployedManifestPath)
  previousRelease = JSON.parse(previousManifestBody.toString('utf8'))
  if (
    previousRelease.schemaVersion !== 1
    || previousRelease.kind !== 'svg3-river-alert-release'
    || previousRelease.layerId !== 'riverLevel'
  ) {
    throw new Error('deployed river alert manifest is invalid')
  }
  const previousTime = Date.parse(previousRelease.snapshotUpdatedAt)
  if (!Number.isFinite(previousTime)) throw new Error('deployed river alert snapshot time is invalid')
  if (releaseInfo.snapshotTime < previousTime) throw new Error('river alert release is older than the deployed snapshot')
  if (
    releaseInfo.snapshotTime === previousTime
    && sha256(previousManifestBody) !== releaseInfo.manifestSha256
  ) {
    throw new Error('river alert release conflicts with the deployed snapshot')
  }
}

const alertPath = 'map/data/alerts/riverLevel.json'
const orderedFiles = [
  ...releaseInfo.files.filter((file) => file.path !== alertPath),
  ...releaseInfo.files.filter((file) => file.path === alertPath),
]
if (dryRun) {
  console.log(
    `[river-alerts:deploy:local] validated ${orderedFiles.length} files, `
    + `${releaseInfo.release.totals.bytes} bytes -> ${targetRoot} (dry-run)`,
  )
  return {
    deployed: false,
    dryRun: true,
    target: targetRoot,
    files: orderedFiles.length,
  }
}

const lockPath = path.join(targetRoot, '.svg3-river-alert-deploy.lock')
const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-river-alert-deploy-backup-'))
const touched = new Map()
let releaseLock
const remember = (relativePath) => {
  if (touched.has(relativePath)) return
  const targetPath = path.join(targetRoot, relativePath)
  const backupPath = path.join(backupRoot, relativePath)
  const existed = fs.existsSync(targetPath)
  if (existed) {
    if (!fs.statSync(targetPath).isFile()) throw new Error(`deploy target is not a file: ${relativePath}`)
    fs.mkdirSync(path.dirname(backupPath), { recursive: true })
    fs.copyFileSync(targetPath, backupPath)
  }
  touched.set(relativePath, existed)
}
const atomicCopy = (sourcePath, relativePath) => {
  const safePath = safeReleasePath(relativePath)
  if (!safePath) throw new Error(`unsafe deploy path: ${relativePath}`)
  remember(safePath)
  const targetPath = path.join(targetRoot, safePath)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  try {
    fs.copyFileSync(sourcePath, temporaryPath)
    const descriptor = fs.openSync(temporaryPath, 'r')
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(temporaryPath, targetPath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}
const restore = () => {
  for (const [relativePath, existed] of [...touched.entries()].reverse()) {
    const targetPath = path.join(targetRoot, relativePath)
    fs.rmSync(targetPath, { force: true })
    if (!existed) continue
    const backupPath = path.join(backupRoot, relativePath)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(backupPath, targetPath)
  }
}

try {
  releaseLock = acquireExclusiveLock(lockPath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  })

  let completed = 0
  const failAfter = environment.NODE_ENV === 'test'
    ? Number(environment.SVG3_TEST_DEPLOY_FAIL_AFTER || 0)
    : 0
  for (const file of orderedFiles) {
    atomicCopy(file.sourcePath, file.path)
    completed += 1
    if (failAfter > 0 && completed >= failAfter) throw new Error('injected deploy failure')
  }

  const previousPaths = new Set(
    Array.isArray(previousRelease?.files)
      ? previousRelease.files.map((file) => {
          const relativePath = safeReleasePath(file?.path)
          if (!relativePath || !isRiverAlertPath(relativePath)) {
            throw new Error(`deployed manifest contains an unsafe path: ${file?.path || ''}`)
          }
          return relativePath
        })
      : [],
  )
  const nextPaths = new Set(orderedFiles.map((file) => file.path))
  for (const stalePath of previousPaths) {
    if (nextPaths.has(stalePath)) continue
    remember(stalePath)
    fs.rmSync(path.join(targetRoot, stalePath), { force: true })
  }

  atomicCopy(releaseInfo.manifestPath, RIVER_ALERT_DEPLOY_MANIFEST)
  console.log(
    `[river-alerts:deploy:local] deployed ${orderedFiles.length} files, `
    + `${releaseInfo.release.totals.bytes} bytes -> ${targetRoot}`,
  )
  return {
    deployed: true,
    dryRun: false,
    target: targetRoot,
    files: orderedFiles.length,
  }
} catch (error) {
  restore()
  throw new Error(`[river-alerts:deploy:local] rolled back: ${error.message}`, { cause: error })
} finally {
  releaseLock?.()
  fs.rmSync(backupRoot, { recursive: true, force: true })
}
}
