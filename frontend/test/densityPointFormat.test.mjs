import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeDensityPointDocument,
  encodeDensityPointDocument,
  validateDensityPointDocument,
} from '../../map/layers/portable/representative-pins/densityPointFormat.js'

const bounds = { minLon: 120, minLat: 20, maxLon: 150, maxLat: 50 }
const encodeBase64 = (bytes) => Buffer.from(bytes).toString('base64')
const decodeBase64 = (base64) => new Uint8Array(Buffer.from(base64, 'base64'))

test('汎用density points形式はlon/latを4byte/件で往復できる', () => {
  const document = encodeDensityPointDocument({
    layerId: 'sample',
    bounds,
    records: [
      { lon: 133.9, lat: 34.6 },
      { lon: 141.3, lat: 43.0 },
    ],
    encodeBase64,
  })
  assert.equal(Buffer.from(document.data, 'base64').length, 8)
  assert.deepEqual(validateDensityPointDocument(document, {
    expectedLayerId: 'sample',
    expectedCount: 2,
  }), [])
  const decoded = decodeDensityPointDocument(document, { decodeBase64 })
  assert.equal(decoded.length, 4)
  assert.ok(Math.abs(decoded[0] - 133.9) < 0.001)
  assert.ok(Math.abs(decoded[1] - 34.6) < 0.001)
  assert.ok(Math.abs(decoded[2] - 141.3) < 0.001)
  assert.ok(Math.abs(decoded[3] - 43.0) < 0.001)
})

test('壊れた形式は実行時に拒否し、検証理由も返す', () => {
  const broken = {
    schemaVersion: 1,
    layerId: 'wrong',
    bounds,
    encoding: 'unknown',
    count: 2,
    data: 'AA==',
  }
  assert.equal(decodeDensityPointDocument(broken, { decodeBase64 }), null)
  assert.ok(validateDensityPointDocument(broken, {
    expectedLayerId: 'sample',
    expectedCount: 3,
  }).length >= 3)
})
