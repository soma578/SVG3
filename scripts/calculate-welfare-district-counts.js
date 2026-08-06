#!/usr/bin/env node
/**
 * 地区ごとの福祉施設数を事前計算
 * turf.jsを使ってPoint-in-Polygon判定を高速化
 *
 * アプローチ：各施設について地区を検索（逆方向）- より効率的
 */

const fs = require('fs')
const path = require('path')
const turf = require('@turf/turf')

console.log('🏥 Calculating welfare facility counts per district...')

// 福祉施設データを読み込み
const welfareFile = path.join(__dirname, '..', 'data', 'source', 'welfare_facilities_roujin.geojson')
if (!fs.existsSync(welfareFile)) {
  console.error('❌ Welfare data not found:', welfareFile)
  process.exit(1)
}

console.log('📂 Loading welfare facilities...')
const welfareData = JSON.parse(fs.readFileSync(welfareFile, 'utf-8'))
const facilities = welfareData.features.filter(f => f.geometry.type === 'Point')
console.log(`✓ Loaded ${facilities.length} facilities`)

// 地区境界データを読み込み
const districtsDir = path.join(__dirname, '..', 'frontend', 'public', 'districts')
const metadataFile = path.join(districtsDir, 'districts_metadata.json')

if (!fs.existsSync(metadataFile)) {
  console.error('❌ Districts metadata not found:', metadataFile)
  process.exit(1)
}

console.log('📂 Loading district boundaries...')
const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
const allDistricts = []

// 全ての地区境界を読み込み
for (const [areaId, area] of Object.entries(metadata.areas)) {
  const districtFile = path.join(districtsDir, area.high_zoom.file)

  if (!fs.existsSync(districtFile)) {
    console.warn(`⚠️  District file not found: ${districtFile}`)
    continue
  }

  const districtData = JSON.parse(fs.readFileSync(districtFile, 'utf-8'))
  const districts = districtData.features

  for (const district of districts) {
    const keyCode = district.properties.key_code || district.properties.KEY_CODE || district.properties.AREA_ID
    if (!keyCode) continue

    // ポリゴンをturf形式に変換
    const polygon = district.geometry.type === 'Polygon'
      ? turf.polygon(district.geometry.coordinates)
      : turf.multiPolygon(district.geometry.coordinates)

    allDistricts.push({
      keyCode,
      name: district.properties.name || keyCode,
      polygon,
      bbox: turf.bbox(polygon)  // バウンディングボックスで高速フィルタリング
    })
  }
}

console.log(`✓ Loaded ${allDistricts.length} districts`)

// カウント初期化
const counts = {}
for (const district of allDistricts) {
  counts[district.keyCode] = 0
}

// 各施設について地区を検索
console.log(`\n🔍 Matching facilities to districts...`)
let matched = 0
let unmatched = 0

for (let i = 0; i < facilities.length; i++) {
  if (i % 1000 === 0) {
    console.log(`   Progress: ${i}/${facilities.length} (${((i/facilities.length)*100).toFixed(1)}%)`)
  }

  const facility = facilities[i]
  const point = turf.point(facility.geometry.coordinates)
  const [lon, lat] = facility.geometry.coordinates

  let found = false

  // まずバウンディングボックスでフィルタリング（高速）
  const candidates = allDistricts.filter(d => {
    const [minLon, minLat, maxLon, maxLat] = d.bbox
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  })

  // 候補の中から実際に含まれる地区を探す
  for (const district of candidates) {
    try {
      if (turf.booleanPointInPolygon(point, district.polygon)) {
        counts[district.keyCode]++
        found = true
        matched++
        break  // 最初に見つかった地区でOK
      }
    } catch (err) {
      // ポリゴンが無効な場合はスキップ
    }
  }

  if (!found) {
    unmatched++
  }
}

console.log(`\n✓ Matched: ${matched} facilities`)
console.log(`✓ Unmatched: ${unmatched} facilities`)
console.log(`✓ Districts with facilities: ${Object.values(counts).filter(c => c > 0).length}`)

// 上位10地区を表示
const topDistricts = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)

console.log(`\n📊 Top 10 districts by facility count:`)
for (const [keyCode, count] of topDistricts) {
  const district = allDistricts.find(d => d.keyCode === keyCode)
  console.log(`   ${district.name}: ${count} facilities`)
}

// 結果を保存
const outputFile = path.join(__dirname, '..', 'frontend', 'public', 'welfare_district_counts.json')
fs.writeFileSync(outputFile, JSON.stringify({
  counts,
  meta: {
    totalDistricts: Object.keys(counts).length,
    districtsWithFacilities: Object.values(counts).filter(c => c > 0).length,
    totalFacilities: Object.values(counts).reduce((a, b) => a + b, 0),
    matched,
    unmatched,
    generatedAt: new Date().toISOString()
  }
}, null, 2))

console.log(`\n💾 Saved to: ${outputFile}`)
console.log('✅ Done!')
