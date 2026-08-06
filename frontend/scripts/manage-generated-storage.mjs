#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  applyBlockers,
  filesystemViolations,
  forbiddenTrackedViolations,
  formatBytes,
  manifestViolations,
  trackingViolations,
} from './lib/storageChecks.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')

const GiB = 1024 ** 3
const MiB = 1024 ** 2

// required: クローン直後から存在していなければならないか。
//   gis-workspace は gitignore、public/* は map:sync が作るので、
//   map:verify の時点では存在しないのが正常。
// maxBytes: 暴走的な肥大を捕まえるための上限。現状値に余裕を持たせてある。
const targets = {
  'gis-workspace': {
    path: path.join(projectRoot, 'map/layers/_build'),
    role: 'manual-cache',
    cleanable: true,
    requiresManualAck: true,
    required: false,
    maxBytes: 8 * GiB,
    rebuild: 'Not rebuilt by map:build; rerun the source GIS/GDAL workflow.',
  },
  'public-map': {
    path: path.join(frontendRoot, 'public/map'),
    role: 'deployment-mirror',
    cleanable: true,
    required: false,
    maxBytes: 2 * GiB,
    rebuild: 'npm run map:sync',
  },
  'portable-releases': {
    path: path.join(projectRoot, 'map/distribution/portable'),
    role: 'tracked-release',
    cleanable: false,
    required: true,
    maxBytes: 256 * MiB,
    rebuild: 'npm run map:release',
  },
  'map-data': {
    path: path.join(projectRoot, 'map/data'),
    role: 'mixed-source-and-generated',
    cleanable: false,
    required: true,
    maxBytes: 4 * GiB,
    rebuild: 'No single rebuild command; contains authoritative snapshots.',
  },
  'detail-shards': {
    path: path.join(projectRoot, 'map/data/qtct'),
    role: 'generated-runtime-data',
    cleanable: false,
    required: true,
    maxBytes: 4 * GiB,
    // 全国detailシャードは map:generate の成果物。恒久追跡しない。
    forbidTrackedGlobs: ['detail-index.json', '/detail/'],
    rebuild: 'npm run generate:representative-qtct',
  },
  'public-districts': {
    path: path.join(frontendRoot, 'public/data'),
    role: 'deployment-mirror',
    cleanable: true,
    // .gitignore excludes this deployment mirror. A clean Vercel clone does
    // not have it yet when map:verify runs; map:sync creates it afterwards.
    required: false,
    maxBytes: 512 * MiB,
    rebuild: 'npm run assets:prepare -- --all-districts',
  },
}

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const values = (name) => {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) result.push(args[index + 1])
    else if (args[index].startsWith(`${name}=`)) result.push(args[index].slice(name.length + 1))
  }
  return result
}

const selectedNames = values('--target')
const apply = has('--apply')
const check = has('--check')
const json = has('--json')
const manualAck = has('--accept-manual-rebuild')

const assertInsideProject = (targetPath) => {
  const relative = path.relative(projectRoot, path.resolve(targetPath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`storage target escapes or equals project root: ${targetPath}`)
  }
}

const measure = (targetPath) => {
  if (!fs.existsSync(targetPath)) return { bytes: 0, files: 0, directories: 0 }
  const stack = [targetPath]
  let bytes = 0
  let files = 0
  let directories = 0
  while (stack.length > 0) {
    const current = stack.pop()
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      directories += 1
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry))
    } else {
      files += 1
      bytes += stat.size
    }
  }
  return { bytes, files, directories }
}

// Vercel のビルド環境には .git が無い（.vercelignore で除外している）。
// Git が使えるかを最初に一度だけ判定し、追跡状態に依存する検査だけを切り離す。
// 「Git が無いから storage:check 全体を成功扱いにする」ことはしない。
const gitAvailable = (() => {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  return result.status === 0 && result.stdout.trim() === 'true'
})()

const trackedPathsOf = (targetPath) => {
  if (!gitAvailable) return null
  const relative = path.relative(projectRoot, targetPath).split(path.sep).join('/')
  const result = spawnSync('git', ['ls-files', '--', relative], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ls-files failed for ${relative}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

const trackedCount = (targetPath) => {
  if (!gitAvailable) return null
  const relative = path.relative(projectRoot, targetPath).split(path.sep).join('/')
  const result = spawnSync('git', ['ls-files', '--', relative], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ls-files failed for ${relative}`)
  return result.stdout.split(/\r?\n/).filter(Boolean).length
}

for (const spec of Object.values(targets)) assertInsideProject(spec.path)

const names = selectedNames.length > 0 ? [...new Set(selectedNames)] : Object.keys(targets)
for (const name of names) {
  if (!targets[name]) {
    throw new Error(`unknown --target "${name}". Available: ${Object.keys(targets).join(', ')}`)
  }
}
if (apply && selectedNames.length === 0) {
  throw new Error('--apply requires at least one explicit --target')
}

const report = names.map((name) => {
  const spec = targets[name]
  return {
    name,
    path: path.relative(projectRoot, spec.path).split(path.sep).join('/'),
    role: spec.role,
    exists: fs.existsSync(spec.path),
    ...measure(spec.path),
    tracked: trackedCount(spec.path),
    trackedPaths: trackedPathsOf(spec.path),
    forbidTrackedGlobs: spec.forbidTrackedGlobs,
    cleanable: spec.cleanable,
    required: spec.required === true,
    maxBytes: spec.maxBytes,
    requiresManualAck: spec.requiresManualAck === true,
    rebuild: spec.rebuild,
  }
})

if (check) {
  // Git の有無に関係なく走る検査。
  const violations = [...filesystemViolations(report)]

  // 生成物マニフェストとの整合。全対象を見ているときだけ意味があるので
  // --target で絞られている場合は対象外にする。
  if (selectedNames.length === 0) {
    const manifestPath = path.join(projectRoot, 'map/data/layer-build-manifest.json')
    let manifest = null
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      violations.push(`layer build manifest could not be read: ${error.message}`)
    }
    if (manifest) {
      violations.push(...manifestViolations(
        manifest,
        (relative) => fs.existsSync(path.join(projectRoot, relative)),
      ))
    }
  }

  // Git があるときだけ走る検査。無いときは理由を明示して飛ばす。
  if (gitAvailable) {
    violations.push(...trackingViolations(report))
    violations.push(...forbiddenTrackedViolations(report))
  } else {
    console.warn(
      '[storage] git metadata is unavailable; skipping tracked-file checks only '
      + '(filesystem, budget and manifest checks still ran)',
    )
  }

  if (violations.length > 0) {
    for (const violation of violations) console.error(`[storage] FAIL: ${violation}`)
    throw new Error(`storage validation failed (${violations.length} issue(s))`)
  }
}

if (json) {
  report.forEach((item) => { item.gitAvailable = gitAvailable; delete item.trackedPaths })
  console.log(JSON.stringify({ schemaVersion: 1, targets: report }, null, 2))
} else {
  for (const item of report) {
    const disposition = item.cleanable ? 'explicit-clean' : 'protected'
    console.log(
      `[storage] ${item.name}: ${formatBytes(item.bytes)}, ${item.files} file(s), `
      + `${item.tracked === null ? 'tracked=unknown (no git)' : `${item.tracked} tracked`}, `
      + `${item.role}, ${disposition}`,
    )
    console.log(`[storage]   ${item.path}; rebuild: ${item.rebuild}`)
  }
}

if (apply) {
  const blockers = report.flatMap((item) => applyBlockers({ item, gitAvailable, manualAck }))
  if (blockers.length > 0) {
    for (const blocker of blockers) console.error(`[storage] FAIL: ${blocker}`)
    throw new Error(`storage deletion refused (${blockers.length} issue(s))`)
  }
  for (const item of report) {
    fs.rmSync(targets[item.name].path, { recursive: true, force: true })
    console.log(`[storage] removed ${item.path} (${formatBytes(item.bytes)})`)
  }
}
