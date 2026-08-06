#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const config = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'map/layers/managed/japan-river-webcams/layer.config.json'),
  'utf8',
))
const policy = config.dataSource?.refreshPolicy || {}

assert.equal(config.dataSource?.delivery, 'scheduled-snapshot')
assert.equal(config.dataSource?.runtimeFetch, false)
assert.ok(policy.minimumIntervalMinutes >= 20 * 24 * 60, 'automatic webcam discovery must run at most every 20 days')
assert.ok(policy.requestDelayMs >= 500, 'upstream requests must be spaced by at least 500ms')
assert.ok(policy.maxConcurrency <= 2, 'upstream concurrency must remain bounded')
assert.ok(policy.minimumCoverageRatio >= 0.9, 'partial snapshots must be rejected')
assert.equal(policy.retainLastGood, true)

const refresh = fs.readFileSync(path.join(scriptDir, 'refresh-river-webcam-source.mjs'), 'utf8')
for (const contract of [
  "process.argv.includes('--if-due')",
  "process.argv.includes('--refresh-metadata')",
  'previousCamerasById',
  'metadata: reused=',
  'refusing partial snapshot',
]) {
  assert.ok(refresh.includes(contract), `refresh script is missing contract: ${contract}`)
}

const releaseBuilder = fs.readFileSync(path.join(scriptDir, 'build-webcam-release.mjs'), 'utf8')
for (const step of [
  'refresh-river-webcam-source.mjs',
  'generate-layer-assets.mjs',
  'check-source-health.mjs',
  'check-native-data-budget.mjs',
  'stage-webcam-release.mjs',
]) {
  assert.ok(releaseBuilder.includes(step), `release pipeline is missing step: ${step}`)
}

const workflow = fs.readFileSync(
  path.join(projectRoot, '.github/workflows/refresh-river-webcams.yml'),
  'utf8',
)
assert.ok(/^\s*schedule\s*:/m.test(workflow), 'webcam registry refresh must run automatically')
assert.ok(workflow.includes("cron: '17 2 1 * *'"), 'automatic webcam registry refresh must remain monthly')
assert.ok(workflow.includes('workflow_dispatch:'), 'webcam registry refresh must also allow operator recovery')
assert.ok(workflow.includes('npm run webcams:release'), 'webcam workflow must build the validated release')
assert.ok(workflow.includes('actions/upload-artifact@v4'), 'webcam workflow must retain a deployable artifact')

// artifact を作るだけでは本番の台帳は古いままなので、書き戻しまでを契約にする。
assert.ok(/^\s*contents:\s*write\s*$/m.test(workflow), 'webcam workflow needs write access to commit the refresh')
assert.ok(workflow.includes('git push'), 'webcam workflow must write the refreshed snapshot back to the branch')
for (const staged of [
  'map/data/source-health/japanRiverWebcam.json',
  'map/data/qtct/japanRiverWebcam',
  'map/sources/japan-river-webcams',
]) {
  assert.ok(workflow.includes(staged), `webcam workflow must commit ${staged}`)
}

// 鮮度切れを放置しないための監視。走査は伴わないこと。
const watchPath = path.join(projectRoot, '.github/workflows/data-freshness-watch.yml')
assert.ok(fs.existsSync(watchPath), 'a data freshness watch workflow is required')
const watch = fs.readFileSync(watchPath, 'utf8')
assert.ok(/^\s*schedule\s*:/m.test(watch), 'the freshness watch must run on a schedule')
assert.ok(watch.includes('--fail-on-stale'), 'the freshness watch must fail when a source is stale')
for (const host of ['river.go.jp', 'river.or.jp', 'webcams:release', 'refresh-river-webcam-source']) {
  assert.ok(!watch.includes(host), `the freshness watch must not touch upstream (${host})`)
}
const healthCheck = fs.readFileSync(path.join(scriptDir, 'check-source-health.mjs'), 'utf8')
assert.ok(healthCheck.includes('--fail-on-stale'), 'check-source-health must support --fail-on-stale')

console.log('[check-webcam-automation] OK: monthly differential refresh and release pipeline are enforced')
