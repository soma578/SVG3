#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { acquireExclusiveLock } from '../../map/publishers/shared/riverAlertRelease.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-river-alert-deploy-check-'))
const targetRoot = path.join(temporaryRoot, 'target')
const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex')
const requiredFiles = [
  'map/data/alerts/riverLevel.json',
  'map/data/qtct/riverLevel/summary.json',
  'map/data/qtct/riverLevel/okayama/detail.json',
  'map/data/search/riverLevel/okayama.json',
  'map/data/source-health/riverLevel.json',
  'map/layers/managed/river-level/publication.json',
]
const makeRelease = (name, snapshotUpdatedAt, tag, mutate = null) => {
  const root = path.join(temporaryRoot, name)
  fs.mkdirSync(root, { recursive: true })
  const files = requiredFiles.map((relativePath) => {
    const body = Buffer.from(`${JSON.stringify({ tag, relativePath })}\n`)
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, body)
    return { path: relativePath, bytes: body.byteLength, sha256: sha256(body) }
  })
  const release = {
    schemaVersion: 1,
    kind: 'svg3-river-alert-release',
    layerId: 'riverLevel',
    generatedAt: snapshotUpdatedAt,
    published: true,
    snapshotUpdatedAt,
    recordCount: 1,
    files,
    totals: {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    },
  }
  mutate?.(release, root)
  fs.writeFileSync(path.join(root, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
  return root
}
const run = (release, extra = [], env = {}) => spawnSync(
  process.execPath,
  [
    path.join(scriptDir, 'run-river-alert-deploy.mjs'),
    '--deployer', 'local-static',
    '--release', release,
    '--target', targetRoot,
    ...extra,
  ],
  {
    cwd: path.resolve(scriptDir, '..'),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  },
)
const snapshotTarget = () => {
  const result = new Map()
  if (!fs.existsSync(targetRoot)) return result
  for (const entry of fs.readdirSync(targetRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.includes('.lock')) continue
    const filePath = path.join(entry.parentPath, entry.name)
    result.set(path.relative(targetRoot, filePath), sha256(fs.readFileSync(filePath)))
  }
  return result
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  const first = makeRelease('first', '2026-07-23T01:00:00.000Z', 'first')
  let result = run(first, ['--initialize-target'])
  assert(result.status === 0, `initial deploy failed: ${result.stderr}`)
  assert(fs.existsSync(path.join(targetRoot, 'map/data/releases/riverLevel.json')), 'deploy manifest missing')
  const beforeFailure = snapshotTarget()

  const newer = makeRelease('newer', '2026-07-23T01:05:00.000Z', 'newer')
  const lockPath = path.join(targetRoot, '.svg3-river-alert-deploy.lock')
  fs.writeFileSync(lockPath, 'owned by another process\n')
  let lockError = null
  try {
    acquireExclusiveLock(lockPath, { pid: process.pid })
  } catch (error) {
    lockError = error
  }
  assert(lockError?.message.includes('already running'), 'concurrent deploy lock was accepted')
  assert(fs.readFileSync(lockPath, 'utf8') === 'owned by another process\n', 'foreign deploy lock was removed')
  fs.rmSync(lockPath)

  result = run(newer, [], { NODE_ENV: 'test', SVG3_TEST_DEPLOY_FAIL_AFTER: '2' })
  assert(result.status !== 0, 'injected failure was accepted')
  assert(JSON.stringify([...snapshotTarget()]) === JSON.stringify([...beforeFailure]), 'rollback changed target')
  assert(!fs.existsSync(path.join(targetRoot, '.svg3-river-alert-deploy.lock')), 'deploy lock leaked')

  const older = makeRelease('older', '2026-07-23T00:55:00.000Z', 'older')
  result = run(older)
  assert(result.status !== 0 && result.stderr.includes('older'), 'older release was accepted')

  const tampered = makeRelease('tampered', '2026-07-23T01:10:00.000Z', 'tampered')
  fs.appendFileSync(path.join(tampered, requiredFiles[0]), 'modified')
  result = run(tampered)
  assert(result.status !== 0 && result.stderr.includes('checksum'), 'tampered release was accepted')

  const traversal = makeRelease('traversal', '2026-07-23T01:10:00.000Z', 'traversal', (release) => {
    release.files[0].path = '../escape.json'
  })
  result = run(traversal)
  assert(result.status !== 0 && result.stderr.includes('unsafe'), 'path traversal was accepted')

  result = run(newer)
  assert(result.status === 0, `newer deploy failed: ${result.stderr}`)
  result = run(newer, ['--dry-run'])
  assert(result.status === 0, `idempotent dry-run failed: ${result.stderr}`)
  console.log('[check-river-alert-deploy] OK: checksums, ordering, rollback and freshness enforced')
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
