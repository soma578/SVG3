#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback = '') => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || '' : fallback
}
const adapterId = option('--adapter')
const inputPath = path.resolve(option('--input'))
const outputPath = option('--output')
const dryRun = args.includes('--dry-run')
if (!/^[a-z][a-z0-9-]+$/.test(adapterId) || !option('--input')) {
  throw new Error(
    'usage: npm run river-alerts:run-provider -- '
    + '--adapter <id> --input <received-file> [--output <release-directory>] [--dry-run]',
  )
}

const adapterRoot = path.join(
  projectRoot,
  'map',
  'publishers',
  'river-alert-feed',
  'adapters',
  adapterId,
)
const configPath = path.join(adapterRoot, 'adapter.config.json')
if (!fs.existsSync(configPath)) throw new Error(`unknown river alert adapter: ${adapterId}`)
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (config.apiVersion !== 1 || config.id !== adapterId || config.networkAccess !== false) {
  throw new Error(`${configPath}: unsupported or unsafe adapter contract`)
}
const modulePath = path.resolve(adapterRoot, config.module || '')
const moduleRelative = path.relative(adapterRoot, modulePath)
if (moduleRelative.startsWith('..') || path.isAbsolute(moduleRelative) || !fs.existsSync(modulePath)) {
  throw new Error(`${configPath}: adapter module escapes its directory or is missing`)
}
if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
  throw new Error(`river alert input not found: ${inputPath}`)
}

const lockPath = path.resolve(option(
  '--lock',
  path.join(os.tmpdir(), `svg3-river-alert-${adapterId}.lock`),
))
let lockFd
let normalizedPath = ''
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (script, scriptArgs) => {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...scriptArgs], {
    cwd: path.resolve(scriptDir, '..'),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with status ${result.status ?? 1}`)
}

try {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  try {
    lockFd = fs.openSync(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`river alert provider is already running: ${lockPath}`)
    throw error
  }
  fs.writeFileSync(lockFd, `${JSON.stringify({
    pid: process.pid,
    adapterId,
    startedAt: new Date().toISOString(),
  })}\n`)

  const before = fs.statSync(inputPath)
  const maxInputBytes = Number(config.maxInputBytes)
  if (!Number.isInteger(maxInputBytes) || maxInputBytes <= 0 || before.size > maxInputBytes) {
    throw new Error(`river alert input exceeds adapter limit: ${before.size} bytes`)
  }
  await sleep(Math.max(250, Number(config.stabilityWaitMs) || 1000))
  const stable = fs.statSync(inputPath)
  if (before.size !== stable.size || before.mtimeMs !== stable.mtimeMs) {
    throw new Error('river alert input changed during stability check')
  }
  const bytes = fs.readFileSync(inputPath)
  const after = fs.statSync(inputPath)
  if (stable.size !== after.size || stable.mtimeMs !== after.mtimeMs) {
    throw new Error('river alert input changed while reading')
  }

  const adapter = await import(pathToFileURL(modulePath).href)
  if (typeof adapter.adaptRiverAlertInput !== 'function') {
    throw new Error(`${configPath}: module must export adaptRiverAlertInput`)
  }
  const feed = await adapter.adaptRiverAlertInput({
    bytes,
    text: bytes.toString('utf8'),
    inputPath,
    inputSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    receivedAt: new Date().toISOString(),
  })
  normalizedPath = path.join(os.tmpdir(), `svg3-river-alert-normalized-${process.pid}.json`)
  fs.writeFileSync(normalizedPath, `${JSON.stringify(feed, null, 2)}\n`, { flag: 'wx' })

  if (dryRun) {
    run('publish-river-alert-feed.mjs', [
      '--input', normalizedPath,
      '--source-id', config.sourceId || adapterId,
      '--dry-run',
    ])
  } else {
    const releaseArgs = [
      '--input', normalizedPath,
      `--source-id=${config.sourceId || adapterId}`,
    ]
    if (outputPath) releaseArgs.push('--output', outputPath)
    run('build-river-alert-release.mjs', releaseArgs)
  }
  console.log(
    `[river-alerts:provider] ${adapterId}: accepted ${before.size} bytes`
    + `${dryRun ? ' (dry-run)' : ''}`,
  )
} finally {
  if (normalizedPath) fs.rmSync(normalizedPath, { force: true })
  if (lockFd !== undefined) {
    fs.closeSync(lockFd)
    fs.rmSync(lockPath, { force: true })
  }
}
