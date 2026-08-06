/**
 * 全国 detail シャードから、県ごとの detail 文書を組み立てる
 * ============================================================
 * 県別 detail.json は恒久保存しない（全国 detail シャードが正）。
 * portable バンドルはリリース時にここで作る。成果物はバンドルの中だけに存在する。
 *
 * 判定に使うのは記録が自分で名乗っている regionId。地理的な範囲で切ると
 * 県境の施設が落ちたり二重になったりするので、範囲では切らない。
 */
import fs from 'node:fs'
import path from 'node:path'

import { makeQtctDocument } from '../../../map/layers/portable/representative-pins/qtctBuilder.mjs'

/** QTCT ツリーの全記録を取り出す。 */
export const collectRecords = (node, out = []) => {
  if (!node) return out
  for (const record of node.records || []) out.push(record)
  for (const child of node.children || []) collectRecords(child, out)
  return out
}

/**
 * 全国 detail シャードを読み、regionId ごとに記録を分ける。
 * 114MB を読むので、1プロセス内では層ごとに一度だけ行う。
 */
const cache = new Map()
export const nationalRecordsByRegion = (mapRoot, layerId) => {
  const key = `${mapRoot}::${layerId}`
  if (cache.has(key)) return cache.get(key)

  const layerRoot = path.join(mapRoot, 'data', 'qtct', layerId)
  const indexPath = path.join(layerRoot, 'detail-index.json')
  if (!fs.existsSync(indexPath)) {
    throw new Error(`national detail index not found: ${indexPath} (run npm run generate:representative-qtct)`)
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  if (index.kind !== 'qtct-shard-index' || !Array.isArray(index.shards)) {
    throw new Error(`not a QTCT shard index: ${indexPath}`)
  }

  const layerLabel = typeof index.label === 'string' ? index.label : null
  const byRegion = new Map()
  for (const shard of index.shards) {
    const shardPath = path.join(layerRoot, shard.url)
    if (!fs.existsSync(shardPath)) throw new Error(`detail shard is missing: ${shardPath}`)
    const document = JSON.parse(fs.readFileSync(shardPath, 'utf8'))
    for (const record of collectRecords(document.tree)) {
      const regionId = String(record.regionId || '').trim()
      if (!regionId) continue
      if (!byRegion.has(regionId)) byRegion.set(regionId, new Map())
      // シャードは境界で重なることがある。id で一意にする。
      byRegion.get(regionId).set(record.id, record)
    }
  }

  const result = new Map(
    [...byRegion].map(([regionId, records]) => [
      regionId,
      // 生成のたびに並びが揺れないよう id で固定する。
      [...records.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    ]),
  )
  cache.set(key, { label: layerLabel, byRegion: result })
  return cache.get(key)
}

/**
 * その県の detail 文書。旧 map/data/.../<region>/detail.json と同じ形。
 * label は全国インデックスのものを優先する。呼び出し側の表示名を使うと
 * 旧ファイルと中身が変わってしまい、移行の同一性が崩れる。
 */
export const regionDetailDocument = ({ mapRoot, layerId, regionId, label }) => {
  const national = nationalRecordsByRegion(mapRoot, layerId)
  const records = national.byRegion.get(regionId) || []
  return makeQtctDocument({ layerId, regionId, label: national.label || label, records })
}
