#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.resolve(scriptDir, '..', '..', 'map', 'webapp', 'shared', 'layerHealth.js'),
  'utf8',
)
const {
  layerHealthStatus,
  loadLayerHealthData,
  validateLayerHealth,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const health = {
  schemaVersion: 1,
  layerId: 'layer-a',
  status: 'healthy',
  staleAfterAt: '2026-07-24T12:00:00+09:00',
}
assert.equal(validateLayerHealth(health, 'layer-a'), true)
assert.equal(validateLayerHealth(health, 'layer-b'), false)
assert.equal(validateLayerHealth({ ...health, status: 'unknown' }, 'layer-a'), false)
assert.equal(layerHealthStatus(health, Date.parse('2026-07-24T11:59:00+09:00')).status, 'healthy')
assert.equal(layerHealthStatus(health, Date.parse('2026-07-24T12:01:00+09:00')).status, 'stale')
assert.equal(layerHealthStatus({ status: 'error' }).status, 'error')

let fetchCount = 0
const layers = [
  { id: 'layer-a', health: '/health.json' },
  { id: 'layer-a', health: '/health.json' },
]
await loadLayerHealthData({
  layers,
  fetchJson: async () => {
    fetchCount += 1
    return health
  },
})
assert.equal(fetchCount, 1)
assert.ok(layers.every((layer) => layer.healthData === health))

console.log('[check-layer-health] OK: health schema, expiry and request deduplication enforced')
