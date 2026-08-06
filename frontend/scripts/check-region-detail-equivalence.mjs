#!/usr/bin/env node
/**
 * 旧・県別 detail.json と、全国シャードから作り直した文書の一致検査
 * ================================================================
 * 県別 detail.json を消す前に、消しても情報が失われないことを確かめる。
 * 見るのは件数・ID集合・主要プロパティ。ツリーの葉の並びは比較しない
 * （空間分割の副産物で、表示にも検索にも影響しない）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectRecords, nationalRecordsByRegion } from './lib/regionDetail.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '../..')
const mapRoot = path.join(projectRoot, 'map')

// 表示・検索・詳細モーダルが実際に読む項目。ここがずれたら移行してはいけない。
const KEY_PROPERTIES = [
  'id', 'title', 'layerId', 'kind', 'status', 'municipalityCode', 'regionId',
  'lat', 'lon', 'summary', 'description', 'address', 'capacity',
]

const layerId = process.argv.includes('--layer')
  ? process.argv[process.argv.indexOf('--layer') + 1]
  : 'evacuation'

const layerRoot = path.join(mapRoot, 'data', 'qtct', layerId)
const regionIds = fs.readdirSync(layerRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'detail' && entry.name !== 'summary')
  .map((entry) => entry.name)
  .filter((regionId) => fs.existsSync(path.join(layerRoot, regionId, 'detail.json')))
  .sort()

assert.ok(regionIds.length > 0, `${layerId}: no legacy per-region detail.json to compare against`)

const rebuilt = nationalRecordsByRegion(mapRoot, layerId).byRegion
const problems = []
let comparedRegions = 0
let comparedRecords = 0

for (const regionId of regionIds) {
  const legacy = JSON.parse(fs.readFileSync(path.join(layerRoot, regionId, 'detail.json'), 'utf8'))
  const legacyRecords = collectRecords(legacy.tree)
  const nextRecords = rebuilt.get(regionId) || []

  if (legacyRecords.length !== nextRecords.length) {
    problems.push(`${regionId}: record count ${legacyRecords.length} -> ${nextRecords.length}`)
  }

  const legacyById = new Map(legacyRecords.map((record) => [record.id, record]))
  const nextById = new Map(nextRecords.map((record) => [record.id, record]))
  const missing = [...legacyById.keys()].filter((id) => !nextById.has(id))
  const added = [...nextById.keys()].filter((id) => !legacyById.has(id))
  if (missing.length > 0) problems.push(`${regionId}: ${missing.length} id(s) lost, e.g. ${missing.slice(0, 3).join(', ')}`)
  if (added.length > 0) problems.push(`${regionId}: ${added.length} unexpected id(s), e.g. ${added.slice(0, 3).join(', ')}`)

  for (const [id, before] of legacyById) {
    const after = nextById.get(id)
    if (!after) continue
    comparedRecords += 1
    for (const property of KEY_PROPERTIES) {
      const a = before[property] ?? null
      const b = after[property] ?? null
      if (a !== b) {
        problems.push(`${regionId}/${id}: ${property} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
      }
    }
    if (problems.length > 40) break
  }
  comparedRegions += 1
  if (problems.length > 40) break
}

// portable バンドルの成果物も同じであること。リリース時生成へ移した以上、
// 配布される中身が旧ファイルと一致することを配布物そのもので確かめる。
let comparedBundles = 0
const portableRoot = path.join(mapRoot, 'distribution', 'portable')
if (fs.existsSync(portableRoot)) {
  for (const bundleDir of fs.readdirSync(portableRoot)) {
    const layerBundleRoot = path.join(portableRoot, bundleDir)
    if (!fs.statSync(layerBundleRoot).isDirectory()) continue
    for (const regionId of fs.readdirSync(layerBundleRoot)) {
      const bundled = path.join(layerBundleRoot, regionId, 'map', 'data', 'qtct', layerId, regionId, 'detail.json')
      const legacyPath = path.join(layerRoot, regionId, 'detail.json')
      if (!fs.existsSync(bundled) || !fs.existsSync(legacyPath)) continue
      const bundledDocument = JSON.parse(fs.readFileSync(bundled, 'utf8'))
      const legacyDocument = JSON.parse(fs.readFileSync(legacyPath, 'utf8'))
      for (const field of ['schemaVersion', 'layerId', 'regionId', 'label', 'total', 'maxDepth', 'leafSize']) {
        if (JSON.stringify(bundledDocument[field]) !== JSON.stringify(legacyDocument[field])) {
          problems.push(
            `${bundleDir}/${regionId} bundle: ${field} `
            + `${JSON.stringify(legacyDocument[field])} -> ${JSON.stringify(bundledDocument[field])}`,
          )
        }
      }
      const bundledIds = new Set(collectRecords(bundledDocument.tree).map((record) => record.id))
      const legacyIds = new Set(collectRecords(legacyDocument.tree).map((record) => record.id))
      const lost = [...legacyIds].filter((id) => !bundledIds.has(id))
      if (lost.length > 0) {
        problems.push(`${bundleDir}/${regionId} bundle: ${lost.length} id(s) lost, e.g. ${lost.slice(0, 3).join(', ')}`)
      }
      comparedBundles += 1
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems.slice(0, 40)) console.error(`[region-detail] FAIL: ${problem}`)
  throw new Error(`per-region detail equivalence failed (${problems.length}+ difference(s))`)
}

console.log(
  `[region-detail] OK: ${layerId} ${comparedRegions} region(s), ${comparedRecords} record(s) `
  + `identical between legacy detail.json and national shards; ${comparedBundles} portable bundle(s) match`,
)
