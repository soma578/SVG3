#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.resolve(scriptDir, '..', '..', 'map', 'webapp', 'shared', 'layerAlertPoller.js'),
  'utf8',
)
const { alertPollInterval, validateLayerAlertSummary } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
)

assert.equal(alertPollInterval([]), 120_000)
assert.equal(alertPollInterval([{ alertFeed: { pollMs: 1_000 } }]), 60_000)
assert.equal(alertPollInterval([{ alertFeed: { pollMs: 300_000 } }]), 300_000)
assert.equal(alertPollInterval([
  { alertFeed: { pollMs: 300_000 } },
  { alertFeed: { pollMs: 600_000 } },
]), 300_000)

const valid = {
  schemaVersion: 1,
  kind: 'svg3-layer-alert-summary',
  layerId: 'layer-river-level',
  maxSeverity: 'danger',
  affected: [],
}
assert.equal(validateLayerAlertSummary(valid, 'layer-river-level'), true)
assert.equal(validateLayerAlertSummary({ ...valid, layerId: 'other' }, 'layer-river-level'), false)
assert.equal(validateLayerAlertSummary({ ...valid, maxSeverity: 'critical' }, 'layer-river-level'), false)
assert.equal(validateLayerAlertSummary({ ...valid, affected: null }, 'layer-river-level'), false)

console.log('[check-layer-alert-poller] OK: configured intervals, minimum delay and feed schema enforced')
