#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveMapTarget, validatePublisherArchive } from './lib/publisherArchive.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const args = process.argv.slice(2)
const archiveArg = args.find((arg) => !arg.startsWith('--'))
const dryRun = args.includes('--dry-run')
const runBuild = !args.includes('--no-build') && !dryRun
if (!archiveArg) throw new Error('usage: npm run publisher:import -- <archive.zip> [--dry-run] [--no-build]')

const archivePath = path.resolve(archiveArg)
const validated = validatePublisherArchive({ archivePath, projectRoot })
const { artifacts, expected, files, manifest, mapRoot } = validated
console.log(`[publisher-import] verified ${manifest.publisherId}: ${expected.size} files, ${artifacts.records.length} records`)
if (dryRun) {
  console.log('[publisher-import] dry-run complete; no files changed')
  process.exit(0)
}

const backups = new Map()
const temporary = []
const transactionId = `${process.pid}-${Date.now()}`
const restore = () => {
  for (const [target, previous] of backups) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (previous === null) fs.rmSync(target, { force: true })
    else fs.writeFileSync(target, previous)
  }
  for (const temp of temporary) fs.rmSync(temp, { force: true })
}

try {
  for (const [relative] of expected) {
    const target = resolveMapTarget(mapRoot, relative)
    backups.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temp = `${target}.publisher-import-${transactionId}`
    fs.writeFileSync(temp, files.get(relative))
    temporary.push(temp)
  }
  for (const [relative] of expected) {
    const target = resolveMapTarget(mapRoot, relative)
    fs.renameSync(`${target}.publisher-import-${transactionId}`, target)
  }
  if (runBuild) {
    const result = spawnSync('npm', ['run', 'map:build'], { cwd: frontendRoot, stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`map:build failed with status ${result.status ?? 'unknown'}`)
  }
} catch (error) {
  restore()
  if (runBuild) {
    console.error('[publisher-import] import failed; restored source files and rebuilding previous generation')
    spawnSync('npm', ['run', 'map:build'], { cwd: frontendRoot, stdio: 'inherit' })
  }
  throw error
}

console.log(`[publisher-import] applied ${expected.size} files from ${path.basename(archivePath)}`)
if (!runBuild) console.log('[publisher-import] run "npm run map:build" before publishing')
