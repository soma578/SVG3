#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeRiverAlertFeed,
  riverAlertCsv,
  riverAlertSummary,
} from '../../map/publishers/river-alert-feed/riverAlertPipeline.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const publisherRoot = path.join(projectRoot, 'map', 'publishers', 'river-alert-feed')
const config = JSON.parse(fs.readFileSync(path.join(publisherRoot, 'publisher.config.json'), 'utf8'))
const fixture = JSON.parse(fs.readFileSync(path.join(publisherRoot, config.fixture), 'utf8'))
const now = Date.parse(fixture.receivedAt)
const result = normalizeRiverAlertFeed(fixture, { now, ...config.policy })

assert.deepEqual(result.errors, [])
assert.deepEqual(result.records.map((record) => record.status), ['normal', 'danger'])
assert.ok(riverAlertCsv(result.records).startsWith('id,regionId,title,river,location,lat,lon,status,'))
const alert = riverAlertSummary(result.records, { generatedAt: fixture.receivedAt })
assert.equal(alert.active, true)
assert.equal(alert.maxSeverity, 'danger')
assert.equal(alert.counts.danger, 1)
assert.equal(alert.affected[0].id, 'fixture-danger')

const stale = structuredClone(fixture)
stale.stations[0].observedAt = new Date(now - 21 * 60_000).toISOString()
assert.equal(normalizeRiverAlertFeed(stale, { now, ...config.policy }).records[0].status, 'stale')

const missing = structuredClone(fixture)
missing.stations[0].quality = 'missing'
missing.stations[0].currentLevel = null
assert.equal(normalizeRiverAlertFeed(missing, { now, ...config.policy }).records[0].status, 'unknown')

const duplicate = structuredClone(fixture)
duplicate.stations[1].id = duplicate.stations[0].id
assert.ok(normalizeRiverAlertFeed(duplicate, { now, ...config.policy }).errors.some((error) =>
  error.includes('duplicated')))

const partial = normalizeRiverAlertFeed(fixture, {
  now,
  ...config.policy,
  previousRecordCount: 10,
})
assert.ok(partial.errors.some((error) => error.includes('partial feed')))
assert.equal(config.policy.retainLastGood, true)
const builder = fs.readFileSync(path.join(scriptDir, 'build-river-alert-release.mjs'), 'utf8')
for (const step of [
  'publish-river-alert-feed.mjs',
  'generate-layer-assets.mjs',
  'check-source-health.mjs',
  'stage-river-alert-release.mjs',
]) {
  assert.ok(builder.includes(step), `river release pipeline is missing ${step}`)
}
const riverController = fs.readFileSync(
  path.join(projectRoot, 'map/layers/portable/river-level/riverLevelLayer.html'),
  'utf8',
)
const representativeCore = fs.readFileSync(
  path.join(projectRoot, 'map/layers/portable/representative-pins/representativePinsCore.js'),
  'utf8',
)
assert.ok(riverController.includes('refreshIntervalMs: 120_000'))
assert.ok(representativeCore.includes("requestCache: Date.now() < state.forceNetworkUntil ? 'no-cache' : 'default'"))
assert.ok(representativeCore.includes("document.visibilityState === 'hidden' || !navigator.onLine"))
const nativeShellHtml = fs.readFileSync(
  path.join(projectRoot, 'map/webapp/native-map.html'),
  'utf8',
)
const nativeShellScript = fs.readFileSync(
  path.join(projectRoot, 'map/webapp/native-map.js'),
  'utf8',
)
const nativeShell = `${nativeShellHtml}\n${nativeShellScript}`
const layerAlertPoller = fs.readFileSync(
  path.join(projectRoot, 'map/webapp/shared/layerAlertPoller.js'),
  'utf8',
)
assert.ok(
  layerAlertPoller.includes("summary.kind === 'svg3-layer-alert-summary'"),
  'alert poller must reject summaries outside the layer alert contract',
)
for (const contract of [
  'state.dismissedAlerts.add(alertKey(summary))',
  'toggleLayer(layer.id, true)',
  'Date.now() - observedAt > staleAfter',
]) {
  assert.ok(nativeShell.includes(contract), `native alert UI is missing ${contract}`)
}
console.log('[check-river-alert-publisher] OK: status, freshness, duplication and coverage contracts')
