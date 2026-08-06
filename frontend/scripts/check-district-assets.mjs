#!/usr/bin/env node
// 配置対象は「活動データを持つ地域」から導く。岡山固定だと、他県へチーム活動を
// 追加した瞬間に地区SVGが 404 になり、ピンもエリアも一切表示されない（実測済み）。
// 空配列を「全県」と解釈すると 767MB を丸ごと載せてしまうので、そこも塞いである。
import assert0 from 'node:assert/strict'
import fs0 from 'node:fs'
import path0 from 'node:path'
import { fileURLToPath as fileURLToPath0 } from 'node:url'

{
  const scriptDir = path0.dirname(fileURLToPath0(import.meta.url))
  const projectRoot = path0.resolve(scriptDir, '..', '..')
  const prepare = fs0.readFileSync(path0.join(scriptDir, 'prepare-public-assets.mjs'), 'utf8')

  assert0.ok(
    prepare.includes('regionsWithTeamActivity'),
    'district staging must be derived from the regions that actually have team activity',
  )
  assert0.ok(
    prepare.includes('ALL_DISTRICT_REGIONS'),
    'staging every region must require an explicit sentinel, not an empty list',
  )
  assert0.ok(
    /requestedRegions === ALL_DISTRICT_REGIONS/.test(prepare),
    'an empty district region list must stage nothing, not everything',
  )
  assert0.ok(
    !/const defaultDistrictRegions = String\(process\.env\.SVG3_DISTRICT_REGIONS \|\| 'okayama'\)/.test(prepare),
    'district staging must not be hardcoded to okayama',
  )

  // 活動データを持つ地域の地区ポリゴンが実在すること（配置できなければ表示できない）。
  const teamActivityRoot = path0.join(projectRoot, 'map/data/qtct/teamActivity')
  if (fs0.existsSync(teamActivityRoot)) {
    for (const entry of fs0.readdirSync(teamActivityRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const detailPath = path0.join(teamActivityRoot, entry.name, 'detail.json')
      if (!fs0.existsSync(detailPath)) continue
      const detail = JSON.parse(fs0.readFileSync(detailPath, 'utf8'))
      if (!(Number(detail.total) > 0)) continue
      const districts = path0.join(projectRoot, 'map/data/districts', entry.name, 'districts-svg')
      assert0.ok(
        fs0.existsSync(districts),
        `${entry.name} has team activity but no district polygons at map/data/districts/${entry.name}`,
      )
    }
  }
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expandTokens } from './lib/scanLayers.mjs'

const projectRoot = path.resolve(process.cwd(), '..')
const districtRoot = path.join(projectRoot, 'map', 'data', 'districts')
const index = JSON.parse(fs.readFileSync(path.join(districtRoot, 'index.json'), 'utf8'))

assert.equal(index.schemaVersion, 1)
assert.equal(index.publicUrlTemplate, '/data/{regionId}/districts-svg/{code}.svg')
assert.equal(
  expandTokens('{districtBaseUrl}/districts-svg/{code}.svg', {
    regionId: 'okayama',
    prefCode: '33',
    districtBaseUrl: 'https://cdn.example.test/districts/okayama',
  }),
  'https://cdn.example.test/districts/okayama/districts-svg/{code}.svg',
)
let totalFiles = 0
let totalBytes = 0
for (const region of index.regions || []) {
  assert.match(region.id, /^[a-z][a-z0-9-]+$/)
  const manifestPath = path.join(districtRoot, region.id, 'assets.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.regionId, region.id)
  assert.equal(manifest.fileCount, manifest.files.length)
  let bytes = 0
  for (const file of manifest.files) {
    assert.match(file.path, /^districts-svg\/\d{5}\.svg$/)
    const assetPath = path.join(districtRoot, region.id, file.path)
    assert.ok(fs.existsSync(assetPath), `${region.id}: missing ${file.path}`)
    const stat = fs.statSync(assetPath)
    assert.equal(stat.size, file.bytes, `${region.id}: size mismatch ${file.path}`)
    bytes += stat.size
  }
  assert.equal(bytes, manifest.bytes)
  assert.equal(region.fileCount, manifest.fileCount)
  assert.equal(region.bytes, manifest.bytes)
  const municipalitiesPath = path.join(projectRoot, 'map', 'regions', region.id, 'municipalities.json')
  const municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, 'utf8')).municipalities || []
  for (const municipality of municipalities) {
    for (const url of municipality.districtSvgUrls || []) {
      const match = String(url).match(new RegExp(`^/data/${region.id}/districts-svg/(\\d{5})\\.svg$`))
      assert.ok(match, `${region.id}/${municipality.id}: invalid legacy district URL ${url}`)
      assert.ok(
        fs.existsSync(path.join(districtRoot, region.id, 'districts-svg', `${match[1]}.svg`)),
        `${region.id}/${municipality.id}: legacy district URL has no source asset ${url}`,
      )
    }
  }
  totalFiles += manifest.fileCount
  totalBytes += manifest.bytes
}
assert.equal(index.totals.regions, index.regions.length)
assert.equal(index.totals.files, totalFiles)
assert.equal(index.totals.bytes, totalBytes)
console.log(`[districts:check] OK: ${index.totals.regions} regions, ${totalFiles} files, ${totalBytes} bytes`)
