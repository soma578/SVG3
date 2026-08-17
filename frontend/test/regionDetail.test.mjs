import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collectRecords, nationalRecordsByRegion, regionDetailDocument } from '../scripts/lib/regionDetail.mjs'

const record = (id, regionId, lon, lat) => ({
  id, regionId, title: id, layerId: 'evacuation', kind: 'shelter', status: 'open', lon, lat,
})

/** 全国シャード一式を作る。県境で重なるシャードを含める。 */
const fixture = (shards) => {
  const mapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'region-detail-'))
  const layerRoot = path.join(mapRoot, 'data', 'qtct', 'evacuation')
  fs.mkdirSync(path.join(layerRoot, 'detail'), { recursive: true })
  const entries = shards.map((records, position) => {
    const url = `detail/shard-${position}.json`
    fs.writeFileSync(
      path.join(layerRoot, url),
      JSON.stringify({ tree: { records, children: [] } }),
    )
    return { url, bounds: { minLon: 130, minLat: 33, maxLon: 135, maxLat: 36 } }
  })
  fs.writeFileSync(path.join(layerRoot, 'detail-index.json'), JSON.stringify({
    schemaVersion: 2,
    kind: 'qtct-shard-index',
    layerId: 'evacuation',
    label: '避難所',
    shards: entries,
  }))
  return mapRoot
}

test('県の記録は regionId で分けられる（範囲では切らない）', () => {
  const mapRoot = fixture([
    [record('a', 'okayama', 133.9, 34.6), record('b', 'hiroshima', 132.4, 34.3)],
    [record('c', 'okayama', 134.2, 34.9)],
  ])
  const national = nationalRecordsByRegion(mapRoot, 'evacuation')
  assert.deepEqual(national.byRegion.get('okayama').map((item) => item.id), ['a', 'c'])
  assert.deepEqual(national.byRegion.get('hiroshima').map((item) => item.id), ['b'])
})

test('県境で重なったシャードの記録は二重にならない', () => {
  // 同じ施設が隣接シャードに現れても、県別 detail に2件出てはいけない。
  const mapRoot = fixture([
    [record('a', 'okayama', 133.9, 34.6)],
    [record('a', 'okayama', 133.9, 34.6), record('b', 'okayama', 134.0, 34.7)],
  ])
  const document = regionDetailDocument({ mapRoot, layerId: 'evacuation', regionId: 'okayama' })
  assert.equal(document.total, 2)
  assert.deepEqual(collectRecords(document.tree).map((item) => item.id).sort(), ['a', 'b'])
})

test('label は全国インデックスのものを使う', () => {
  // 呼び出し側の表示名を使うと、旧県別 detail.json と中身が変わってしまう。
  const mapRoot = fixture([[record('a', 'okayama', 133.9, 34.6)]])
  const document = regionDetailDocument({
    mapRoot, layerId: 'evacuation', regionId: 'okayama', label: 'L2 避難所',
  })
  assert.equal(document.label, '避難所')
})

test('記録がない県も空の有効なdetail文書になる', () => {
  const mapRoot = fixture([[record('a', 'okayama', 133.9, 34.6)]])
  const document = regionDetailDocument({
    mapRoot, layerId: 'evacuation', regionId: 'hokkaido', label: '避難所',
  })
  assert.equal(document.total, 0)
  assert.equal(document.tree, null)
})

test('シャードが欠けていたら黙って少ない結果を返さない', () => {
  // 欠けたまま出すと、避難所が丸ごと消えたバンドルを配ってしまう。
  const mapRoot = fixture([[record('a', 'okayama', 133.9, 34.6)]])
  fs.rmSync(path.join(mapRoot, 'data', 'qtct', 'evacuation', 'detail', 'shard-0.json'))
  assert.throws(
    () => nationalRecordsByRegion(mapRoot, 'evacuation'),
    /detail shard is missing/,
  )
})

test('全国インデックスが無ければ理由を示して失敗する', () => {
  const mapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'region-detail-'))
  assert.throws(
    () => nationalRecordsByRegion(mapRoot, 'evacuation'),
    /national detail index not found/,
  )
})
