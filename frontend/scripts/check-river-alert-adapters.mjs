#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const adaptersRoot = path.join(
  projectRoot,
  'map/publishers/river-alert-feed/adapters',
)
const adapters = []
for (const entry of fs.readdirSync(adaptersRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const root = path.join(adaptersRoot, entry.name)
  const config = JSON.parse(fs.readFileSync(path.join(root, 'adapter.config.json'), 'utf8'))
  assert.equal(config.apiVersion, 1)
  assert.equal(config.id, entry.name)
  assert.equal(config.networkAccess, false)
  assert.ok(Number.isInteger(config.maxInputBytes) && config.maxInputBytes > 0)
  assert.ok(Number.isInteger(config.stabilityWaitMs) && config.stabilityWaitMs >= 250)
  const modulePath = path.resolve(root, config.module)
  assert.equal(path.dirname(modulePath), root)
  const source = fs.readFileSync(modulePath, 'utf8')
  assert.ok(source.includes('adaptRiverAlertInput'))
  assert.ok(!/\bfetch\s*\(|https?:\/\//.test(source), `${entry.name}: adapter must not perform network access`)
  adapters.push(entry.name)
}
assert.ok(adapters.length > 0)

const fixture = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'map/publishers/river-alert-feed/fixture.json'),
  'utf8',
))
const now = new Date()
fixture.receivedAt = now.toISOString()
for (const station of fixture.stations) station.observedAt = new Date(now.getTime() - 60_000).toISOString()
fixture.stations = Array.from({ length: 8 }, (_, index) => {
  const source = fixture.stations[index % fixture.stations.length]
  return {
    ...source,
    id: `${source.id}-${index + 1}`,
    title: `${source.title} ${index + 1}`,
    lat: source.lat + index * 0.001,
    lon: source.lon + index * 0.001,
  }
})
const inputPath = path.join(os.tmpdir(), `svg3-river-adapter-check-${process.pid}.json`)
const lockPath = path.join(os.tmpdir(), `svg3-river-adapter-check-${process.pid}.lock`)
fs.writeFileSync(inputPath, `${JSON.stringify(fixture)}\n`)
const result = spawnSync(process.execPath, [
  path.join(scriptDir, 'run-river-alert-provider.mjs'),
  '--adapter', 'normalized-json',
  '--input', inputPath,
  '--lock', lockPath,
  '--dry-run',
], {
  cwd: path.resolve(scriptDir, '..'),
  encoding: 'utf8',
})
assert.equal(result.status, 0, result.stderr || result.stdout)
assert.ok(!fs.existsSync(lockPath), 'provider lock must be released')
fs.writeFileSync(lockPath, 'occupied\n')
const locked = spawnSync(process.execPath, [
  path.join(scriptDir, 'run-river-alert-provider.mjs'),
  '--adapter', 'normalized-json',
  '--input', inputPath,
  '--lock', lockPath,
  '--dry-run',
], {
  cwd: path.resolve(scriptDir, '..'),
  encoding: 'utf8',
})
fs.rmSync(inputPath, { force: true })
fs.rmSync(lockPath, { force: true })
assert.notEqual(locked.status, 0)
assert.ok(locked.stderr.includes('already running'))
console.log(`[check-river-alert-adapters] OK: ${adapters.join(', ')}`)
