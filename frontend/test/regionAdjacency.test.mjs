import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAdjacency } from '../scripts/generate-region-adjacency.mjs'
import { loadLayerCatalog, neighborCatalogUrl } from '../../map/webapp/shared/layerCatalog.js'
import { isNeighborMountId, neighborMountId } from '../scripts/lib/scanLayers.mjs'

// 隣接判定は行政界データの共有頂点から導く。ハードコードした県境表を持つと
// 行政界が変わったときに黙って古い隣接関係を配ることになる。

const region = (id, prefCode, label) => ({ id, prefCode, label })

// 2つの正方形が辺を共有する / 離れている、という最小の形で判定を確かめる。
const square = (pref, minLon, minLat, size = 1) => ({
  properties: { pref },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [minLon, minLat],
      [minLon + size, minLat],
      [minLon + size, minLat + size],
      [minLon, minLat + size],
      [minLon, minLat],
    ]],
  },
})

const regions = [region('alpha', '01', 'アルファ県'), region('bravo', '02', 'ブラボー県'), region('charlie', '03', 'チャーリー県')]

test('境界頂点を共有する県だけを陸の隣接とする', () => {
  const { neighbors, edgeCount } = buildAdjacency({
    // alpha と bravo は 131 度線上の2頂点を共有する。charlie は遠く離れている。
    features: [square(1, 130, 34), square(2, 131, 34), square(3, 140, 34)],
    regions,
    straitLinks: [{ pair: ['alpha', 'charlie'], via: 'テスト海峡' }],
  })
  assert.equal(edgeCount, 2)
  assert.deepEqual(neighbors.bravo.map((entry) => entry.id), ['alpha'])
  assert.deepEqual(neighbors.charlie.map((entry) => entry.id), ['alpha'])
  const [land, strait] = neighbors.alpha
  assert.equal(land.id, 'bravo')
  assert.equal(land.relation, 'land')
  assert.ok(land.sharedBoundaryCells > 0)
  // 陸続きを先に、海を越える相手を後に並べる。
  assert.equal(strait.id, 'charlie')
  assert.equal(strait.relation, 'strait')
  assert.equal(strait.via, 'テスト海峡')
})

test('隣接は対称で、境界の長い相手から並ぶ', () => {
  const { neighbors } = buildAdjacency({
    // bravo は alpha と辺全体を、charlie とは角だけを共有する。
    features: [square(1, 130, 34), square(2, 131, 34), square(3, 132, 35)],
    regions,
    straitLinks: [],
  })
  assert.deepEqual(neighbors.bravo.map((entry) => entry.id), ['alpha', 'charlie'])
  assert.ok(neighbors.bravo[0].sharedBoundaryCells > neighbors.bravo[1].sharedBoundaryCells)
  for (const [id, list] of Object.entries(neighbors)) {
    for (const entry of list) {
      assert.ok(neighbors[entry.id].some((back) => back.id === id), `${id}-${entry.id} is not symmetric`)
    }
  }
})

test('陸続きの組を海峡として二重宣言できない', () => {
  assert.throws(() => buildAdjacency({
    features: [square(1, 130, 34), square(2, 131, 34), square(3, 140, 34)],
    regions,
    straitLinks: [{ pair: ['alpha', 'bravo'], via: '誤り' }],
  }), /already shares a land boundary/)
})

test('周辺地域mountのidは基のレイヤーと隣接県から決まる', () => {
  const id = neighborMountId('layer-hazard', 'hiroshima')
  assert.equal(id, 'layer-hazard--near-hiroshima')
  assert.ok(isNeighborMountId(id))
  assert.ok(!isNeighborMountId('layer-hazard'))
})

// カタログ併合。周辺地域レイヤーは県ごとに違うので別ファイルにあり、
// 取得できない環境でも本体のカタログだけで地図が成立しなければならない。

const catalogResponse = {
  layers: [{ id: 'layer-base', label: '本体', visible: true }],
  presets: [{ id: 'preset', label: 'preset', layers: ['layer-base'] }],
}
const supplementResponse = {
  layers: [{ id: 'layer-base--near-hiroshima', label: '広島県 本体', visible: false }],
  neighbors: [{ id: 'hiroshima', label: '広島県', prefCode: '34', relation: 'land' }],
}

const fetchStub = (routes) => async (url) => {
  const body = routes[url]
  if (!body) return { ok: false, json: async () => null }
  return { ok: true, json: async () => body }
}

test('周辺地域カタログを本体カタログへ併合する', async () => {
  const result = await loadLayerCatalog({
    containerUrl: '/unused.svg',
    supplementUrl: neighborCatalogUrl('okayama'),
    fetchImpl: fetchStub({
      '/map/layers/catalog.json': catalogResponse,
      '/map/regions/okayama/neighbor-catalog.json': supplementResponse,
    }),
  })
  assert.equal(result.source, 'catalog')
  assert.deepEqual(result.layers.map((layer) => layer.id), ['layer-base', 'layer-base--near-hiroshima'])
  assert.equal(result.layers[1].visible, false)
  assert.deepEqual(result.neighbors.map((entry) => entry.id), ['hiroshima'])
})

test('周辺地域カタログが取れなくても本体カタログで成立する', async () => {
  const result = await loadLayerCatalog({
    containerUrl: '/unused.svg',
    supplementUrl: neighborCatalogUrl('okayama'),
    fetchImpl: fetchStub({ '/map/layers/catalog.json': catalogResponse }),
  })
  assert.deepEqual(result.layers.map((layer) => layer.id), ['layer-base'])
  assert.deepEqual(result.neighbors, [])
})

test('地域を指定しなければ周辺地域カタログを取りに行かない', async () => {
  const requested = []
  await loadLayerCatalog({
    containerUrl: '/unused.svg',
    supplementUrl: neighborCatalogUrl(''),
    fetchImpl: async (url) => {
      requested.push(url)
      return { ok: true, json: async () => catalogResponse }
    },
  })
  assert.deepEqual(requested, ['/map/layers/catalog.json'])
})
