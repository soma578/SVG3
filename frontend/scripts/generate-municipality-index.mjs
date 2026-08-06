#!/usr/bin/env node
/**
 * 全国市区町村の検索索引を作る
 * ============================
 * 出力: map/regions/municipalities-index.json
 *
 * 検索は現在表示中の地域の市区町村しか対象にしていなかったため、
 * 「広島市」と打っても岡山を見ていると1件も出なかった。
 * 全県分を1ファイルにまとめて、どこからでも市区町村名で飛べるようにする。
 *
 * 検索に要る最小限だけを入れる（各 municipalities.json 全体を集めると重くなる）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const regionsRoot = path.join(projectRoot, 'map', 'regions')

const regionsIndex = JSON.parse(fs.readFileSync(path.join(regionsRoot, 'index.json'), 'utf8'))
const regionList = Array.isArray(regionsIndex) ? regionsIndex : regionsIndex.regions || []

const entries = []
for (const region of regionList) {
  const regionId = String(region.id || region.regionId || '')
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(regionId)) continue
  const file = path.join(regionsRoot, regionId, 'municipalities.json')
  if (!fs.existsSync(file)) continue
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  const regionLabel = document.label || region.label || regionId
  for (const municipality of document.municipalities || []) {
    const viewport = municipality.viewport || {}
    if (!Number.isFinite(Number(viewport.lat)) || !Number.isFinite(Number(viewport.lon))) continue
    entries.push({
      id: String(municipality.id || ''),
      label: String(municipality.label || ''),
      regionId,
      regionLabel,
      displayCode: String(municipality.displayCode || ''),
      shelterCount: Number(municipality.shelterCount) || 0,
      dataStatus: municipality.dataStatus || '',
      viewport: {
        lat: Number(viewport.lat),
        lon: Number(viewport.lon),
        latSpan: Number(viewport.latSpan) || 0.2,
        lonSpan: Number(viewport.lonSpan) || 0.2,
      },
    })
  }
}

entries.sort((a, b) => a.regionId.localeCompare(b.regionId) || a.label.localeCompare(b.label, 'ja'))

const output = {
  schemaVersion: 1,
  kind: 'svg3-municipality-index',
  total: entries.length,
  municipalities: entries,
}
const outPath = path.join(regionsRoot, 'municipalities-index.json')
const body = `${JSON.stringify(output)}\n`
if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== body) {
  fs.writeFileSync(outPath, body, 'utf8')
}
console.log(`[municipality-index] ${entries.length} municipalities from ${regionList.length} regions, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KiB`)
