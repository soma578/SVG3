import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCsvQtctArtifacts } from '../../map/publishers/shared/csvQtctPipeline.mjs'

const regions = [{ id: 'okayama', label: '岡山県', prefecture: '岡山県', prefCode: '33' }]
const config = {
  id: 'layer-team-activity-pins',
  build: {
    qtctLayer: 'teamActivity',
    requiredColumns: ['id', 'title', 'prefecture', 'municipality', 'districtName'],
    requiredValueColumns: ['id', 'title', 'prefecture', 'municipality', 'districtName'],
    prefectureColumn: 'prefecture',
    municipalityNameColumn: 'municipality',
    districtNameColumn: 'districtName',
  },
}
const districtIndexes = new Map([['okayama', {
  regionId: 'okayama',
  districts: [{
    key: '33101002001',
    name: '岡山市 北区 谷万成一丁目',
    municipalityCode: '33101',
    municipalityName: '岡山市北区',
    lat: 34.67672,
    lon: 133.901007,
  }],
}]])

test('市区町村名と地区境界名から地区キー・代表座標を補完する', () => {
  const csvText = [
    'id,title,prefecture,municipality,districtName',
    'team-1,給水支援,岡山県,岡山市北区,谷万成一丁目',
  ].join('\n')
  const result = buildCsvQtctArtifacts({ csvText, regions, config, districtIndexes })
  assert.deepEqual(result.errors, [])
  assert.equal(result.records.length, 1)
  assert.equal(result.records[0].regionId, 'okayama')
  assert.equal(result.records[0].municipalityCode, '33101')
  assert.equal(result.records[0].municipalityName, '岡山市北区')
  assert.equal(result.records[0].districtKey, '33101002001')
  assert.equal(result.records[0].districtName, '岡山市 北区 谷万成一丁目')
  assert.equal(result.records[0].lat, 34.67672)
  assert.equal(result.records[0].lon, 133.901007)
})

test('存在しない地区境界名は黙って座標化しない', () => {
  const csvText = [
    'id,title,prefecture,municipality,districtName',
    'team-1,給水支援,岡山県,岡山市北区,存在しない町',
  ].join('\n')
  const result = buildCsvQtctArtifacts({ csvText, regions, config, districtIndexes })
  assert.equal(result.records.length, 0)
  assert.ok(result.errors.some((error) => error.includes('地区境界が見つかりません')))
})
