#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const args = process.argv.slice(2)
const input = args.find((arg) => arg.startsWith('--input='))
  || (() => {
    const index = args.indexOf('--input')
    return index >= 0 ? `--input=${args[index + 1] || ''}` : ''
  })()
if (!input || input === '--input=') {
  throw new Error('usage: npm run river-alerts:release -- --input <authorized-feed.json> [--output <directory>]')
}
const sourceId = args.find((arg) => arg.startsWith('--source-id='))
const now = args.find((arg) => arg.startsWith('--now='))
const stageArgs = []
const outputEquals = args.find((arg) => arg.startsWith('--output='))
if (outputEquals) stageArgs.push(outputEquals)
else {
  const index = args.indexOf('--output')
  if (index >= 0) stageArgs.push('--output', args[index + 1] || '')
}

const run = (script, scriptArgs = []) => {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...scriptArgs], {
    cwd: path.resolve(scriptDir, '..'),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with status ${result.status ?? 1}`)
}

const protectedPaths = [
  'map/layers/managed/river-level/data.csv',
  'map/layers/managed/river-level/publication.json',
  'map/data/source-health/riverLevel.json',
  'map/data/alerts/riverLevel.json',
  'map/data/qtct/riverLevel',
  'map/data/search/riverLevel',
  'map/data/layer-build-manifest.json',
]
const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-river-alert-backup-'))
for (const relativePath of protectedPaths) {
  const source = path.join(projectRoot, relativePath)
  if (!fs.existsSync(source)) continue
  const target = path.join(backupRoot, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
}
const restore = () => {
  for (const relativePath of protectedPaths) {
    const target = path.join(projectRoot, relativePath)
    const backup = path.join(backupRoot, relativePath)
    fs.rmSync(target, { recursive: true, force: true })
    if (!fs.existsSync(backup)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(backup, target, { recursive: true })
  }
}

try {
  run('publish-river-alert-feed.mjs', [input, sourceId, now].filter(Boolean))
  run('generate-layer-assets.mjs', ['--layer', 'riverLevel'])
  run('check-source-health.mjs')
  run('check-river-alert-publisher.mjs')
  run('stage-river-alert-release.mjs', stageArgs)
} catch (error) {
  restore()
  console.error(`[river-alerts:release] rolled back: ${error.message}`)
  process.exit(1)
} finally {
  fs.rmSync(backupRoot, { recursive: true, force: true })
}
