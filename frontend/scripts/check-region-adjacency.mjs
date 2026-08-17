#!/usr/bin/env node
/**
 * check-region-adjacency.mjs
 *
 * 周辺地域（県境をまたぐ重ね合わせ）の契約を検証する。
 *
 *   1. adjacency.json が行政界データから再生成した結果と一致する（ドリフト禁止）
 *   2. 隣接関係が対称で、自己参照や未知の地域を含まない
 *   3. 47地域すべてに neighbor-catalog.json があり、隣接県ぶんのmountを宣言する
 *   4. 宣言した周辺地域mountが、その地域のContainerに非表示で1つずつ存在する
 *   5. 周辺地域mountのhrefが「隣接県自身の資産」を指す（自県の資産の複製ではない）
 *   6. 周辺地域mountのidが全国共通カタログと衝突しない
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildAdjacency } from './generate-region-adjacency.mjs'
import { isNeighborMountId, neighborMountId } from './lib/scanLayers.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const regionsDir = path.join(projectRoot, 'map', 'regions')
const containersDir = path.join(projectRoot, 'map', 'containers')

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const index = readJson(path.join(regionsDir, 'index.json'))
const regions = index.regions ?? []
const regionIds = new Set(regions.map((region) => region.id))
const adjacency = readJson(path.join(regionsDir, 'adjacency.json'))
const catalog = readJson(path.join(projectRoot, 'map', 'layers', 'catalog.json'))
const catalogIds = new Set((catalog.layers || []).map((layer) => layer.id))

// 1. 生成物が行政界データと乖離していない
const regenerated = buildAdjacency({
  features: readJson(path.join(projectRoot, 'prefectures.geojson')).features ?? [],
  regions,
  straitLinks: readJson(path.join(regionsDir, 'adjacency.config.json')).straitLinks ?? [],
})
assert.deepEqual(
  adjacency.neighbors,
  regenerated.neighbors,
  'map/regions/adjacency.json is stale — run `npm run regions:adjacency`',
)

// 2. 隣接グラフの健全性
assert.equal(Object.keys(adjacency.neighbors).length, regions.length)
const edgeSet = new Set()
for (const [regionId, neighbors] of Object.entries(adjacency.neighbors)) {
  assert.ok(regionIds.has(regionId), `adjacency declares unknown region "${regionId}"`)
  assert.ok(neighbors.length > 0, `${regionId} has no neighbor`)
  const seen = new Set()
  for (const neighbor of neighbors) {
    assert.ok(regionIds.has(neighbor.id), `${regionId}: unknown neighbor "${neighbor.id}"`)
    assert.notEqual(neighbor.id, regionId, `${regionId}: neighbor cannot be itself`)
    assert.ok(!seen.has(neighbor.id), `${regionId}: duplicate neighbor "${neighbor.id}"`)
    seen.add(neighbor.id)
    assert.ok(['land', 'strait'].includes(neighbor.relation), `${regionId}: unknown relation`)
    if (neighbor.relation === 'land') {
      assert.ok(neighbor.sharedBoundaryCells > 0, `${regionId}-${neighbor.id}: land edge shares no boundary`)
    } else {
      assert.ok(neighbor.via, `${regionId}-${neighbor.id}: strait edge must name the crossing`)
    }
    const reverse = adjacency.neighbors[neighbor.id] || []
    assert.ok(
      reverse.some((entry) => entry.id === regionId),
      `adjacency is not symmetric: ${regionId} -> ${neighbor.id}`,
    )
    edgeSet.add([regionId, neighbor.id].sort().join(' '))
  }
}
assert.equal(edgeSet.size, adjacency.edgeCount, 'edgeCount does not match the declared edges')

// 3.-6. 地域ごとの周辺地域カタログとContainer
let mountCount = 0
for (const region of regions) {
  const catalogPath = path.join(regionsDir, region.id, 'neighbor-catalog.json')
  assert.ok(fs.existsSync(catalogPath), `missing neighbor catalog: ${catalogPath}`)
  const neighborCatalog = readJson(catalogPath)
  assert.equal(neighborCatalog.regionId, region.id)

  const expectedNeighbors = adjacency.neighbors[region.id].map((neighbor) => neighbor.id)
  assert.deepEqual(
    neighborCatalog.neighbors.map((neighbor) => neighbor.id),
    expectedNeighbors,
    `${region.id}: neighbor catalog does not match adjacency.json`,
  )

  const containerPath = path.join(containersDir, `Containers_webapp_denshi_${region.prefCode}.svg`)
  assert.ok(fs.existsSync(containerPath), `missing container: ${containerPath}`)
  const container = fs.readFileSync(containerPath, 'utf8')
  const animations = new Map(
    [...container.matchAll(/<animation\b[^>]*>/g)]
      .map((match) => [match[0].match(/\bid="([^"]+)"/)?.[1] || '', match[0]]),
  )

  const declaredMountIds = new Set()
  for (const layer of neighborCatalog.layers) {
    const neighborRegion = layer.neighborRegion
    assert.ok(neighborRegion?.id, `${region.id}: ${layer.id} does not name its neighbor region`)
    assert.ok(
      expectedNeighbors.includes(neighborRegion.id),
      `${region.id}: ${layer.id} targets a non-adjacent region`,
    )
    assert.ok(isNeighborMountId(layer.id), `${region.id}: ${layer.id} is not a neighbor mount id`)
    assert.equal(
      layer.id,
      neighborMountId(layer.id.split('--near-')[0], neighborRegion.id),
      `${region.id}: ${layer.id} id does not follow the neighbor mount convention`,
    )
    assert.ok(!catalogIds.has(layer.id), `${region.id}: ${layer.id} collides with the shared catalog`)
    assert.ok(!declaredMountIds.has(layer.id), `${region.id}: duplicate neighbor mount ${layer.id}`)
    declaredMountIds.add(layer.id)
    assert.equal(layer.visible, false, `${region.id}: ${layer.id} must start hidden`)
    // 検索索引・警報ポーリング・鮮度は本体mountが1つだけ持つ。
    assert.equal(layer.search, null, `${region.id}: ${layer.id} must not duplicate the search index`)
    assert.equal(layer.alertFeed, null, `${region.id}: ${layer.id} must not duplicate alert polling`)
    assert.deepEqual(layer.mounts, [layer.id])
    assert.equal(layer.toggleKey, layer.id)
    // controller管理にすると隣接県ぶんのcontrollerが起動時に立ち上がる。
    assert.equal(
      layer.visibilityStrategy,
      'native',
      `${region.id}: ${layer.id} must stay lazily loaded`,
    )

    const tag = animations.get(layer.id)
    assert.ok(tag, `${region.id}: container has no animation for ${layer.id}`)
    assert.ok(/visibility="hidden"/.test(tag), `${region.id}: ${layer.id} must be hidden in the container`)
    const href = decodeURIComponent((tag.match(/xlink:href="([^"]+)"/)?.[1] || '').replaceAll('&amp;', '&'))
    assert.ok(
      href.includes(neighborRegion.id) || href.includes(`/${Number(neighborRegion.prefCode)}/`),
      `${region.id}: ${layer.id} does not point at ${neighborRegion.id} assets (${href})`,
    )
    assert.ok(
      !href.includes(`layerKey=${layer.id.split('--near-')[0]}&`)
      && !href.endsWith(`layerKey=${layer.id.split('--near-')[0]}`),
      `${region.id}: ${layer.id} must not reuse the base layer key`,
    )
    mountCount += 1
  }

  for (const id of animations.keys()) {
    if (!isNeighborMountId(id)) continue
    assert.ok(
      declaredMountIds.has(id),
      `${region.id}: container declares neighbor mount ${id} that the catalog does not`,
    )
  }
}

console.log(
  `[check-region-adjacency] OK: ${regions.length} regions, ${adjacency.edgeCount} adjacency edges,`
  + ` ${mountCount} neighbor mounts declared and mounted`,
)
