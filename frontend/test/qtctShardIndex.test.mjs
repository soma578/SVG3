import assert from 'node:assert/strict'
import test from 'node:test'

import {
  intersectsQtctBounds,
  selectQtctDensityCells,
  selectQtctFeatures,
  targetDepthForZoom,
} from '../../map/layers/portable/representative-pins/qtctFeatureEngine.js'
import { makeQtctDensityCells, makeQtctDensityGrid, makeQtctDocument } from '../../map/layers/portable/representative-pins/qtctBuilder.mjs'
import { PIN_LAYER_PROFILES } from '../../map/layers/portable/representative-pins/pinLayerProfiles.js'

// 全国 summary は 96 個のシャードに分かれている。インデックスには各シャードの
// depth と representative が載っているので、本体を取得していない「スタブ」の
// まま描画できる ── これが成り立たないと全国ズームで 15MB 取りに行く。

const bounds = (minLon, minLat, maxLon, maxLat) => ({ minLon, minLat, maxLon, maxLat })
const view = { x: 130, y: 30, width: 10, height: 10 }

const stub = (id, depth, box, count) => ({
  depth,
  bounds: box,
  count,
  stub: true,
  representative: { id, lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2, count },
})

const indexTree = (children) => ({
  depth: 0,
  bounds: bounds(120, 20, 155, 46),
  count: children.reduce((sum, child) => sum + child.count, 0),
  representative: { id: 'root', lat: 35, lon: 137, count: 1000 },
  children,
})

test('個別ピンは従来より2段階早いzoom 11で表示する', () => {
  const leaf = {
    depth: 12,
    bounds: bounds(130, 30, 140, 40),
    count: 2,
    representative: { id: 'leaf-summary', lon: 135, lat: 35, count: 2 },
    records: [
      { id: 'detail-a', lon: 134, lat: 34 },
      { id: 'detail-b', lon: 136, lat: 36 },
    ],
  }
  const tree = {
    depth: 0,
    bounds: bounds(130, 30, 140, 40),
    count: 2,
    representative: { id: 'summary', lon: 135, lat: 35, count: 2 },
    children: [{
      depth: 9,
      bounds: bounds(130, 30, 140, 40),
      count: 2,
      representative: { id: 'depth-9-summary', lon: 135, lat: 35, count: 2 },
      children: [leaf],
    }],
  }

  assert.deepEqual(selectQtctFeatures({ tree, view, zoom: 10.99 }).map((item) => item.id), ['depth-9-summary'])
  assert.deepEqual(selectQtctFeatures({ tree, view, zoom: 11 }).map((item) => item.id), ['detail-a', 'detail-b'])
  for (const profile of Object.values(PIN_LAYER_PROFILES)) {
    assert.equal(profile.individualZoom, 11)
    assert.equal(profile.densityMaxZoom, 11)
    assert.ok(profile.attribution?.label, `${profile.label}: property attribution is required`)
  }
})

test('避難所プロパティは国土地理院の正本を出典にする', () => {
  assert.deepEqual(PIN_LAYER_PROFILES.evacuation.attribution, {
    label: '国土地理院「指定緊急避難場所・指定避難所データ」',
    url: 'https://www.gsi.go.jp/bousaichiri/hinanbasho.html',
  })
})

test('未取得シャードのスタブだけでピンを描ける', () => {
  const tree = indexTree([
    stub('a', 5, bounds(130, 30, 135, 35), 400),
    stub('b', 5, bounds(135, 30, 140, 35), 600),
  ])
  const features = selectQtctFeatures({ tree, view, zoom: 6, individualZoom: 12 })
  assert.ok(features.length > 0, 'スタブから少なくとも1つのピンが出ること')
  assert.ok(features.every((feature) => feature.id))
})

test('低ズームでは代表地点ではなくQTCT区画と件数を密度表示へ渡す', () => {
  const tree = indexTree([
    stub('inside-a', 5, bounds(130, 30, 135, 35), 400),
    stub('inside-b', 5, bounds(135, 30, 140, 35), 600),
    stub('outside', 5, bounds(150, 42, 154, 45), 900),
  ])
  const cells = selectQtctDensityCells({ tree, view, zoom: 6 })
  assert.deepEqual(cells.map((cell) => cell.count), [400, 600])
  assert.deepEqual(cells[0].bounds, bounds(130, 30, 135, 35))
  assert.equal(cells.some((cell) => cell.representative?.id === 'outside'), false)
})

test('低・中ズームとも集計区画でなく実地点をピクセル化する', () => {
  const tree = indexTree([{
    depth: 5,
    bounds: bounds(130, 30, 140, 40),
    count: 3,
    representative: { id: 'rep', lon: 135, lat: 35, count: 3 },
    densityPoints: new Float64Array([
      131.25, 31.5,
      133.75, 34.5,
      145, 45,
    ]),
  }])
  for (const zoom of [6, 10.5]) {
    const cells = selectQtctDensityCells({ tree, view, zoom })
    assert.deepEqual(cells.map((cell) => [cell.representative.lon, cell.representative.lat]), [
      [131.25, 31.5],
      [133.75, 34.5],
    ])
    assert.ok(cells.every((cell) => cell.count === 1))
  }
})

test('density pointsが画面外なら中央に架空の集計ピクセルを作らない', () => {
  const tree = {
    ...indexTree([]),
    densityPoints: new Float64Array([
      133.9278, 34.6679,
      133.9195, 34.6624,
    ]),
  }
  const away = { x: 134.4, y: 34.4, width: 0.2, height: 0.2 }
  assert.deepEqual(selectQtctDensityCells({ tree, view: away, zoom: 12.5 }), [])
})

test('事前集計セルはシャード境界より細かく、件数を失わない', () => {
  const records = [
    { lon: 130.01, lat: 30.01 },
    { lon: 130.02, lat: 30.02 },
    { lon: 142.7, lat: 35.6 },
  ]
  const cells = makeQtctDensityCells(records, { bounds: bounds(120, 20, 144, 44), depth: 3 })
  assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), records.length)
  assert.equal(cells.length, 2)
  assert.ok(cells.every((cell) => cell.bounds.maxLon - cell.bounds.minLon <= 3.0002))
  const grid = makeQtctDensityGrid(records, { bounds: bounds(120, 20, 144, 44), depth: 3 })
  assert.deepEqual(grid.cells.map((entry) => entry[1]), cells.map((cell) => cell.count))

  const tree = { ...indexTree([]), densityCells: cells }
  const selected = selectQtctDensityCells({ tree, view, zoom: 6 })
  assert.equal(selected.reduce((sum, cell) => sum + cell.count, 0), 2)
})

test('シャード化しないsummaryにも固定密度セルを含める', () => {
  const records = [
    { id: 'a', title: 'A', lat: 34.6, lon: 133.9 },
    { id: 'b', title: 'B', lat: 43.0, lon: 141.3 },
  ]
  const document = makeQtctDocument({ layerId: 'sample', regionId: 'all', label: 'sample', records, summary: true })
  assert.equal(document.tree.densityCells.length, 2)
  assert.equal(document.tree.densityCells.reduce((sum, cell) => sum + cell.count, 0), 2)
})

test('ビューポート外のシャードは選ばれない', () => {
  const tree = indexTree([
    stub('inside', 5, bounds(130, 30, 135, 35), 400),
    stub('outside', 5, bounds(150, 42, 154, 45), 400),
  ])
  const features = selectQtctFeatures({ tree, view, zoom: 6, individualZoom: 12 })
  assert.ok(features.some((feature) => feature.id === 'inside'))
  assert.ok(!features.some((feature) => feature.id === 'outside'))
})

test('深さの揃わないシャードが混在しても走査できる', () => {
  // 適応分割の結果、シャードの深さは 3〜7 で不揃いになる。
  const tree = indexTree([
    stub('shallow', 3, bounds(130, 30, 134, 34), 50),
    stub('deep', 7, bounds(134, 30, 138, 34), 900),
  ])
  const features = selectQtctFeatures({ tree, view, zoom: 6, individualZoom: 12 })
  assert.ok(features.length > 0)
  assert.ok(features.every((feature) => Number.isFinite(feature.lat)))
})

test('シャード本体が要るのは根より深い描画のときだけ', () => {
  // ensureSummaryShardsForView が使う判定と同じ条件を固定する。
  const needsShardBody = (shardDepth, zoom) => targetDepthForZoom(zoom) > shardDepth

  assert.equal(needsShardBody(5, 7), false, '全国ズームでは深さ5のシャード本体は不要')
  assert.equal(needsShardBody(5, 9.5), true, '県レベルでは深さ5のシャード本体が要る')
  assert.equal(needsShardBody(7, 9.5), false, '深いシャードは県レベルでも根で足りる')
  assert.equal(needsShardBody(3, 7), true, '浅いシャードは全国ズームでも本体が要る')
})

test('intersectsQtctBounds は境界の接触を交差とみなす', () => {
  assert.equal(intersectsQtctBounds(bounds(130, 30, 135, 35), view), true)
  assert.equal(intersectsQtctBounds(bounds(140, 40, 145, 45), view), true, '角で接する')
  assert.equal(intersectsQtctBounds(bounds(141, 41, 145, 45), view), false)
  assert.equal(intersectsQtctBounds(null, view), false)
})
